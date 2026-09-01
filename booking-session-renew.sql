-- ============================================================
-- 登录滑动续期（增量脚本，老库单独跑这一个文件即可）
--
-- 作用：会话原本写死 30 天过期，长期使用的老用户每隔一个月会莫名掉线、
--       需要重新登录。改成「滑动续期」：只要剩余有效期不足 7 天，
--       下次打开页面时自动再延 30 天。
--
--       常来预约的人 → 基本不会掉线
--       超过 30 天没来的人 → 会话自然失效，重新登录即可（符合预期）
--
-- 前提：已经跑过 booking-schema.sql（表都已存在）
-- 影响：只替换 me() 一个函数，不动任何数据，可重复执行
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

  -- 滑动续期：剩余有效期不足 7 天时，自动再延 30 天
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

revoke all on function public.me(text) from public;
grant execute on function public.me(text) to anon, authenticated;

-- ============================================================
-- 验证（可选，跑完看一眼）：
--   select proname, prosrc like '%滑动续期%' as 已生效
--     from pg_proc where proname = 'me';
-- 返回 t 即说明替换成功。
-- ============================================================
