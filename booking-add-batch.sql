-- ============================================================
-- 增量：多选时间段批量预约（在已有库上执行，无需重跑主 schema）
--
-- 设计：要么全部约上，要么一个都不约（连续时段中间被抢会失去意义）。
-- 执行：Supabase → SQL Editor → 粘贴全部 → Run
-- ============================================================

-- 批量预约：p_hours 是 jsonb 数组 [{"day":"2026-09-07","hour":9}, ...]
-- 返回 json：
--   {code:'OK', count:N}
--   {code:'CONFLICT', list:['09-07 9:00 已被约', ...]}   有时段不可用，整体拒绝
--   {code:'TAKEN',   list:[...]}                          检查完到插入之间被抢（整事务回滚）
--   {code:'NO_AUTH' / 'BAD_DEVICE' / 'EMPTY' / 'TOO_MANY'}
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
  -- 身份
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

  -- 设备
  if p_device not in ('prep', 'semi') then
    return json_build_object('code', 'BAD_DEVICE');
  end if;

  -- 数量
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) = 0 then
    return json_build_object('code', 'EMPTY');
  end if;
  if jsonb_array_length(p_hours) > 8 then
    return json_build_object('code', 'TOO_MANY');
  end if;

  -- 先全部检查：有任何一个不可用 → 整体拒绝，一个都不插
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
  -- 极端情况：检查通过到插入之间被别人抢走，整个事务回滚
  return json_build_object(
    'code', 'TAKEN',
    'list', to_json(ARRAY['所选时段中有刚被别人约走的，请刷新后重新选择'])
  );
end;
$$;

revoke all on function public.book_slots(text, text, jsonb, text, text) from public;
grant execute on function public.book_slots(text, text, jsonb, text, text) to anon, authenticated;
