-- ============================================================
-- 预约时间上限（增量脚本，老库单独跑这一个文件即可）
--
-- 作用：只能预约到下周（下周日），下下周一及以后不开放。
--       前端只是限制翻页和点选，真正的拦截在数据库这两个函数里——
--       就算有人绕过页面直接调接口，也约不进下下周。
--
-- 判定：date_trunc('week', 北京时间) 取本周周一，+14 天 = 下下周一（第一个不可约日）
--
-- 前提：已经跑过 booking-schema.sql
-- 影响：只替换 book_slot / book_slots 两个函数，不动任何数据，可重复执行
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
  v_uid   uuid;
  v_name  text;
  v_limit date;   -- 第一个不可预约的日期：下下周一
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

  -- 预约窗口上限：只能约到下周
  v_limit := (date_trunc('week', now() at time zone 'Asia/Shanghai') + interval '14 days')::date;
  if p_day >= v_limit then
    return 'TOO_FAR';
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
  v_limit     date;   -- 第一个不可预约的日期：下下周一
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

  -- 预约窗口上限：只能约到下周
  v_limit := (date_trunc('week', now() at time zone 'Asia/Shanghai') + interval '14 days')::date;

  -- 先全部检查：任何一个不可用 → 整体拒绝，一个都不插
  for v_item in select * from jsonb_array_elements(p_hours) loop
    v_day  := (v_item ->> 'day')::date;
    v_hour := (v_item ->> 'hour')::int;

    if v_hour is null or v_hour < 8 or v_hour > 21 then
      v_conflicts := v_conflicts || (to_char(v_day, 'MM-DD') || ' ' || coalesce(v_hour::text, '?') || ':00 时段无效');
    elsif v_day >= v_limit then
      v_conflicts := v_conflicts || (to_char(v_day, 'MM-DD') || ' ' || v_hour || ':00 尚未开放');
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

revoke all on function public.book_slot(date, int, text, text, text, text) from public;
grant execute on function public.book_slot(date, int, text, text, text, text) to anon, authenticated;
revoke all on function public.book_slots(text, text, jsonb, text, text) from public;
grant execute on function public.book_slots(text, text, jsonb, text, text) to anon, authenticated;

-- ============================================================
-- 验证（可选，跑完看一眼）：
--   select proname, prosrc like '%v_limit%' as 已生效
--     from pg_proc where proname in ('book_slot','book_slots') order by proname;
-- 两行都返回 t 即说明替换成功。
-- ============================================================
