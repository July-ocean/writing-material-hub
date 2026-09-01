-- ============================================================
-- 快速修复：注册/登录报 "gen_salt does not exist"
--
-- 原因：pgcrypto 扩展装在 extensions schema，
--       而函数的 search_path 只写了 public，函数内部找不到 gen_salt / crypt。
-- 执行：Supabase → SQL Editor → 粘贴全部 → Run
-- ============================================================

-- 1) 确保扩展存在（Supabase 约定装在 extensions schema）
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- 2) 想确认扩展装在哪，可以单独跑这句（应该看到 nspname = extensions）：
--    select extname, nspname from pg_extension e
--      join pg_namespace n on n.oid = e.extnamespace
--     where extname = 'pgcrypto';

-- 3) 给所有相关函数的 search_path 补上 extensions
alter function public.register_user(text, text, text)              set search_path = public, extensions;
alter function public.login_user(text, text)                       set search_path = public, extensions;
alter function public.me(text)                                     set search_path = public, extensions;
alter function public.logout(text)                                 set search_path = public, extensions;
alter function public.book_slot(date, int, text, text, text, text) set search_path = public, extensions;
alter function public.cancel_slot(text, text)                      set search_path = public, extensions;
alter function public.my_bookings(text)                            set search_path = public, extensions;

-- 跑完这一份，注册 / 登录即可正常工作。
-- 以后再重跑完整版 booking-schema.sql 也不会把这个修复覆盖掉（主文件已同步修正）。
