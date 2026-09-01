-- ============================================================
-- 制备 / 半制备系统预约 · 建表 + 用户系统 + 安全函数
--
-- 两台设备独立预约：制备(prep) 一台、半制备(semi) 一台，互不干扰。
--
-- 用法：Supabase 控制台 → 左侧 SQL Editor → 粘贴 → Run
-- 幂等：可重复执行。已建旧表的重跑即可升级（补列、换主键格式、迁移旧数据）。
-- ============================================================

-- 密码哈希需要 pgcrypto；Supabase 约定扩展装在 extensions schema，
-- 因此下面所有函数的 search_path 都写成 public, extensions，
-- 否则函数内部找不到 gen_salt / crypt（会报 gen_salt does not exist）
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- 1) 用户表
-- ============================================================
create table if not exists public.prep_users (
  id           uuid primary key default gen_random_uuid(),
  username     text not null unique,     -- 登录账号
  display_name text not null,            -- 显示在格子上的真实姓名
  pass_hash    text not null,            -- bcrypt，永不外泄
  created_at   timestamptz not null default now()
);

-- ============================================================
-- 2) 会话表
-- ============================================================
create table if not exists public.prep_sessions (
  token      text primary key,
  user_id    uuid not null references public.prep_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

create index if not exists prep_sessions_user_idx on public.prep_sessions (user_id);
create index if not exists prep_sessions_exp_idx  on public.prep_sessions (expires_at);

-- ============================================================
-- 3) 预约表
--    id = 'YYYY-MM-DD#HH#设备'  例：'2026-09-07#08#prep'
--    主键唯一 → 同一设备的同一时段只能一个人；两台设备彼此独立
-- ============================================================
create table if not exists public.prep_bookings (
  id          text primary key,
  day         date        not null,
  hour        int         not null,             -- 8..21（21 = 21:00-22:00）
  device      text        not null default 'prep',  -- 'prep' 制备 / 'semi' 半制备
  name        text        not null,             -- 冗余显示名
  note        text        not null default '',  -- 自由备注
  aqueous     text        not null default '',  -- 水相：0.05%盐酸 / 0.1%甲酸 / 其它：xxx
  user_id     uuid        references public.prep_users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 旧表升级：补列
alter table public.prep_bookings add column if not exists device  text not null default 'prep';
alter table public.prep_bookings add column if not exists aqueous text not null default '';
alter table public.prep_bookings add column if not exists user_id uuid
  references public.prep_users(id) on delete set null;

-- 旧数据迁移：给不带设备后缀的主键补上 '#prep'（无旧数据时不影响）
update public.prep_bookings
   set id = id || '#prep'
 where id !~ '#(prep|semi)$';

-- 设备合法性约束（已存在则跳过）
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'prep_bookings_device_chk'
       and conrelid = 'public.prep_bookings'::regclass
  ) then
    alter table public.prep_bookings
      add constraint prep_bookings_device_chk check (device in ('prep','semi'));
  end if;
end $$;

create index if not exists prep_bookings_day_idx    on public.prep_bookings (day);
create index if not exists prep_bookings_user_idx   on public.prep_bookings (user_id);
create index if not exists prep_bookings_device_idx on public.prep_bookings (device, day);

-- ============================================================
-- 4) 权限模型
--    · prep_bookings：anon 只读（排班要透明，大家才好避让）
--    · prep_users / prep_sessions：anon 零权限，一切走函数
-- ============================================================
alter table public.prep_bookings enable row level security;
alter table public.prep_users    enable row level security;
alter table public.prep_sessions enable row level security;

revoke all on public.prep_bookings from anon, authenticated;
grant select on public.prep_bookings to anon, authenticated;

revoke all on public.prep_users    from anon, authenticated;
revoke all on public.prep_sessions from anon, authenticated;

drop policy if exists prep_bookings_select_all on public.prep_bookings;
create policy prep_bookings_select_all
  on public.prep_bookings for select
  to anon, authenticated
  using (true);

-- ============================================================
-- 5) 注册
--    返回 OK / EXISTS / WEAK / BAD_USERNAME / BAD_NAME
-- ============================================================
create or replace function public.register_user(
  p_username     text,
  p_password     text,
  p_display_name text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_u text := lower(btrim(coalesce(p_username, '')));
  v_d text := btrim(coalesce(p_display_name, ''));
  v_p text := coalesce(p_password, '');
begin
  if char_length(v_u) < 3 or char_length(v_u) > 20 then
    return 'BAD_USERNAME';
  end if;
  if v_u !~ '^[a-z0-9_.-]+$' then
    return 'BAD_USERNAME';
  end if;
  if char_length(v_d) < 1 or char_length(v_d) > 12 then
    return 'BAD_NAME';
  end if;
  if char_length(v_p) < 6 or char_length(v_p) > 64 then
    return 'WEAK';
  end if;
  if exists (select 1 from public.prep_users where username = v_u) then
    return 'EXISTS';
  end if;

  insert into public.prep_users (username, display_name, pass_hash)
  values (v_u, v_d, crypt(v_p, gen_salt('bf', 8)));

  return 'OK';
end;
$$;

-- ============================================================
-- 6) 登录：成功返回会话 token，失败返回 BAD
-- ============================================================
create or replace function public.login_user(p_username text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_u   text := lower(btrim(coalesce(p_username, '')));
  v_rec record;
  v_tok text;
begin
  delete from public.prep_sessions where expires_at < now() - interval '7 days';

  select id, pass_hash into v_rec
    from public.prep_users
   where username = v_u;

  if not found then
    return 'BAD';
  end if;

  if v_rec.pass_hash <> crypt(coalesce(p_password, ''), v_rec.pass_hash) then
    return 'BAD';
  end if;

  v_tok := encode(gen_random_bytes(24), 'hex');
  insert into public.prep_sessions (token, user_id) values (v_tok, v_rec.id);

  return v_tok;
end;
$$;

-- ============================================================
-- 7) 当前登录用户（刷新后恢复登录态），无效 token 返回 null
-- ============================================================
create or replace function public.me(p_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rec record;
begin
  if p_token is null or p_token = '' then
    return null;
  end if;

  select u.id, u.username, u.display_name into v_rec
    from public.prep_sessions s
    join public.prep_users u on u.id = s.user_id
   where s.token = p_token
     and s.expires_at > now();

  if not found then
    return null;
  end if;

  -- 滑动续期：剩余有效期不足 7 天时，自动再延 30 天。
  -- 每次打开页面都会调 me()，所以常来预约的人不会莫名掉线；
  -- 长时间不来的（超过 30 天）会话自然失效，仍需重新登录。
  update public.prep_sessions
     set expires_at = now() + interval '30 days'
   where token = p_token
     and expires_at < now() + interval '7 days';

  return json_build_object(
    'user_id',      v_rec.id,
    'username',     v_rec.username,
    'display_name', v_rec.display_name
  );
end;
$$;

-- ============================================================
-- 8) 退出登录
-- ============================================================
create or replace function public.logout(p_token text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  delete from public.prep_sessions where token = p_token;
$$;

-- ============================================================
-- 9) 预约（必须已登录）
--    p_device : 'prep' 制备 / 'semi' 半制备
--    p_aqueous: 水相，可为空；选「其它」时前端传 '其它：xxx'
--    返回 OK / TAKEN / PAST / OUT_OF_RANGE / BAD_DEVICE / NO_AUTH
-- ============================================================
create or replace function public.book_slot(
  p_day     date,
  p_hour    int,
  p_session text,
  p_device  text,
  p_note    text,
  p_aqueous text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid  uuid;
  v_name text;
begin
  select user_id into v_uid
    from public.prep_sessions
   where token = p_session and expires_at > now();

  if v_uid is null then
    return 'NO_AUTH';
  end if;

  select display_name into v_name from public.prep_users where id = v_uid;
  if v_name is null then
    return 'NO_AUTH';
  end if;

  if p_device not in ('prep', 'semi') then
    return 'BAD_DEVICE';
  end if;

  if p_hour < 8 or p_hour > 21 then
    return 'OUT_OF_RANGE';
  end if;

  -- 已开始的时段不能约（北京时间）
  if (p_day + p_hour * interval '1 hour') < (now() at time zone 'Asia/Shanghai') then
    return 'PAST';
  end if;

  insert into public.prep_bookings (id, day, hour, device, name, note, aqueous, user_id)
  values (
    to_char(p_day, 'YYYY-MM-DD') || '#' || lpad(p_hour::text, 2, '0') || '#' || p_device,
    p_day, p_hour, p_device, v_name,
    coalesce(p_note, ''),
    left(coalesce(p_aqueous, ''), 60),
    v_uid
  );

  return 'OK';

-- 同设备同时段撞主键 → 已被约走（另一台设备不受影响）
exception when unique_violation then
  return 'TAKEN';
end;
$$;

-- ============================================================
-- 10) 取消：只能取消自己的（按 user_id 匹配）
--     返回 OK / NO_AUTH / NOT_OWNER
-- ============================================================
create or replace function public.cancel_slot(p_id text, p_session text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
  n     int;
begin
  select user_id into v_uid
    from public.prep_sessions
   where token = p_session and expires_at > now();

  if v_uid is null then
    return 'NO_AUTH';
  end if;

  delete from public.prep_bookings
   where id = p_id and user_id = v_uid;

  get diagnostics n = row_count;

  if n = 0 then
    return 'NOT_OWNER';
  end if;

  return 'OK';
end;
$$;

-- ============================================================
-- 11) 批量预约：多选时段一次提交
--     要么全部约上，要么一个都不约（连续时段中间被抢没有意义）
--     p_hours 是 jsonb 数组 [{"day":"2026-09-07","hour":9}, ...]
--     返回 {code:OK,count:N} / {code:CONFLICT,list:[...]} /
--          {code:TAKEN,list:[...]} / NO_AUTH / BAD_DEVICE / EMPTY / TOO_MANY
-- ============================================================
create or replace function public.book_slots(
  p_session text,
  p_device  text,
  p_hours   jsonb,
  p_note    text,
  p_aqueous text
) returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid       uuid;
  v_name      text;
  v_item      jsonb;
  v_day       date;
  v_hour      int;
  v_conflicts text[] := '{}';
  v_ok        int := 0;
begin
  select user_id into v_uid
    from public.prep_sessions
   where token = p_session and expires_at > now();
  if v_uid is null then
    return json_build_object('code', 'NO_AUTH');
  end if;

  select display_name into v_name from public.prep_users where id = v_uid;
  if v_name is null then
    return json_build_object('code', 'NO_AUTH');
  end if;

  if p_device not in ('prep', 'semi') then
    return json_build_object('code', 'BAD_DEVICE');
  end if;

  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) = 0 then
    return json_build_object('code', 'EMPTY');
  end if;
  if jsonb_array_length(p_hours) > 8 then
    return json_build_object('code', 'TOO_MANY');
  end if;

  -- 先全部检查：任何一个不可用 → 整体拒绝，一个都不插
  for v_item in select * from jsonb_array_elements(p_hours) loop
    v_day  := (v_item ->> 'day')::date;
    v_hour := (v_item ->> 'hour')::int;

    if v_hour is null or v_hour < 8 or v_hour > 21 then
      v_conflicts := v_conflicts || (to_char(v_day, 'MM-DD') || ' ' || coalesce(v_hour::text, '?') || ':00 时段无效');
    elsif (v_day + v_hour * interval '1 hour') < (now() at time zone 'Asia/Shanghai') then
      v_conflicts := v_conflicts || (to_char(v_day, 'MM-DD') || ' ' || v_hour || ':00 已过期');
    elsif exists (
      select 1 from public.prep_bookings
       where id = to_char(v_day, 'YYYY-MM-DD') || '#' || lpad(v_hour::text, 2, '0') || '#' || p_device
    ) then
      v_conflicts := v_conflicts || (to_char(v_day, 'MM-DD') || ' ' || v_hour || ':00 已被约');
    end if;
  end loop;

  if array_length(v_conflicts, 1) is not null then
    return json_build_object('code', 'CONFLICT', 'list', to_json(v_conflicts));
  end if;

  -- 全部可用：同一事务内逐条插入，任何一条撞主键则整体回滚
  for v_item in select * from jsonb_array_elements(p_hours) loop
    v_day  := (v_item ->> 'day')::date;
    v_hour := (v_item ->> 'hour')::int;

    insert into public.prep_bookings (id, day, hour, device, name, note, aqueous, user_id)
    values (
      to_char(v_day, 'YYYY-MM-DD') || '#' || lpad(v_hour::text, 2, '0') || '#' || p_device,
      v_day, v_hour, p_device, v_name,
      coalesce(p_note, ''),
      left(coalesce(p_aqueous, ''), 60),
      v_uid
    );
    v_ok := v_ok + 1;
  end loop;

  return json_build_object('code', 'OK', 'count', v_ok);

exception when unique_violation then
  return json_build_object(
    'code', 'TAKEN',
    'list', to_json(ARRAY['所选时段中有刚被别人约走的，请刷新后重新选择'])
  );
end;
$$;

-- ============================================================
-- 12) 我的预约：跨周、跨设备返回本人名下全部未来机时
--     无效会话返回 null，无预约返回 []
-- ============================================================
create or replace function public.my_bookings(p_session text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
  v_res json;
begin
  select user_id into v_uid
    from public.prep_sessions
   where token = p_session and expires_at > now();

  if v_uid is null then
    return null;
  end if;

  select coalesce(json_agg(row_to_json(x)), '[]'::json) into v_res
  from (
    select day, hour, device, name, note, aqueous
      from public.prep_bookings
     where user_id = v_uid
       and day >= (now() at time zone 'Asia/Shanghai')::date
     order by day, hour, device
  ) x;

  return v_res;
end;
$$;

-- ============================================================
-- 12) 只开放这些函数给前端
-- ============================================================
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'register_user', 'login_user', 'me', 'logout',
        'book_slot', 'book_slots', 'cancel_slot', 'my_bookings'
      )
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;

-- ============================================================
-- 常用运维语句（按需手动执行，不要一次全跑）
-- ============================================================
-- 看某一周两台设备的排班：
--   select day, hour, device, name, aqueous, note
--     from public.prep_bookings
--    where day between '2026-09-07' and '2026-09-13'
--    order by device, day, hour;
--
-- 只看制备：
--   select day, hour, name, aqueous from public.prep_bookings
--    where device = 'prep' and day between '2026-09-07' and '2026-09-13' order by day, hour;
--
-- 统计每台设备被约了多少小时：
--   select device, count(*) as 已约时段数
--     from public.prep_bookings group by device;
--
-- 看所有已注册用户（不含密码）：
--   select username, display_name, created_at from public.prep_users order by created_at;
--
-- 重置某人密码：
--   update public.prep_users set pass_hash = crypt('新密码', gen_salt('bf', 8))
--    where username = 'liming';
--
-- 管理员强制删除某个时段（绕过归属校验）：
--   delete from public.prep_bookings where id = '2026-09-07#08#prep';
--
-- 清空全部预约（保留账号）：
--   truncate public.prep_bookings;
