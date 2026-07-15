-- ============================================================
-- 作文素材坊 · GitHub Pages 直连版数据库脚本
-- 在 Supabase 项目的 SQL Editor 里「全选粘贴、执行一次」即可。
-- 架构：纯前端(GitHub Pages) 直连 Supabase，安全完全由 RLS 行级策略保证。
-- ============================================================

-- 若之前跑过「Node 后端版」的 schema.sql，会留下 users/materials 等旧表。
-- 先清空它们（含外键），再用下面的语句重建 GitHub Pages 版所需结构，避免冲突。
drop table if exists comments cascade;
drop table if exists favorites cascade;
drop table if exists likes cascade;
drop table if exists materials cascade;
drop table if exists users cascade;

create extension if not exists "pgcrypto";

-- ---------------- 表结构 ----------------

-- 用户资料表：id 与 Supabase Auth 的用户一一对应
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null,
  name       text not null,
  role       text not null default 'student',   -- student / teacher
  created_at bigint not null default (extract(epoch from now())*1000)::bigint
);

-- 素材表（author_id 只是记录发布者 uid，不做外键，方便保留演示数据）
create table if not exists materials (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  intro           text not null,
  content         text not null,
  source          text not null,
  author_id       uuid,
  author_name     text,
  author_role     text,
  status          text not null default 'pending',  -- pending / approved / rejected
  created_at      bigint not null,
  approved_at     bigint,
  likes_count     int not null default 0,
  favorites_count int not null default 0,
  comments_count  int not null default 0
);

create table if not exists likes (
  user_id     uuid not null,
  material_id uuid not null references materials(id) on delete cascade,
  primary key (user_id, material_id)
);

create table if not exists favorites (
  user_id     uuid not null,
  material_id uuid not null references materials(id) on delete cascade,
  primary key (user_id, material_id)
);

create table if not exists comments (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  user_id     uuid,
  user_name   text,
  content     text not null,
  created_at  bigint not null
);

-- ---------------- 辅助函数 ----------------

-- 判断当前登录用户是否为教师（SECURITY DEFINER 绕过 profiles 的 RLS，避免递归）
create or replace function is_teacher() returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'teacher');
$$;
grant execute on function is_teacher() to authenticated, anon;

-- 维护点赞/收藏/评论计数（SECURITY DEFINER，绕过 RLS 更新计数）
create or replace function bump_counts() returns trigger
  language plpgsql security definer
  set search_path = public
as $$
begin
  if TG_TABLE_NAME = 'likes' then
    if TG_OP = 'INSERT' then update materials set likes_count = likes_count + 1 where id = NEW.material_id;
    elsif TG_OP = 'DELETE' then update materials set likes_count = greatest(likes_count - 1, 0) where id = OLD.material_id; end if;
  elsif TG_TABLE_NAME = 'favorites' then
    if TG_OP = 'INSERT' then update materials set favorites_count = favorites_count + 1 where id = NEW.material_id;
    elsif TG_OP = 'DELETE' then update materials set favorites_count = greatest(favorites_count - 1, 0) where id = OLD.material_id; end if;
  elsif TG_TABLE_NAME = 'comments' then
    if TG_OP = 'INSERT' then update materials set comments_count = comments_count + 1 where id = NEW.material_id;
    elsif TG_OP = 'DELETE' then update materials set comments_count = greatest(comments_count - 1, 0) where id = OLD.material_id; end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_likes_count on likes;
create trigger trg_likes_count after insert or delete on likes
  for each row execute function bump_counts();
drop trigger if exists trg_favorites_count on favorites;
create trigger trg_favorites_count after insert or delete on favorites
  for each row execute function bump_counts();
drop trigger if exists trg_comments_count on comments;
create trigger trg_comments_count after insert or delete on comments
  for each row execute function bump_counts();

-- 限制注册人数不超过 100（满足「100 人以内」要求）
create or replace function check_user_cap() returns trigger
  language plpgsql security definer
  set search_path = public
as $$
begin
  if (select count(*) from profiles) >= 100 then
    raise exception '注册人数已达上限（100 人）';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_user_cap on profiles;
create trigger trg_user_cap before insert on profiles
  for each row execute function check_user_cap();

-- ---------------- 行级安全策略（RLS）----------------
alter table profiles  enable row level security;
alter table materials enable row level security;
alter table likes     enable row level security;
alter table favorites enable row level security;
alter table comments  enable row level security;

-- profiles：登录用户都能读（显示昵称）；只能创建自己的资料，且只能是学生（防止自封教师）
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated using (true);
drop policy if exists profiles_insert_self on profiles;
create policy profiles_insert_self on profiles for insert to authenticated
  with check (id = auth.uid() and role = 'student');

-- materials：已通过的所有人可见；自己的（任何状态）可见；教师可见全部
drop policy if exists materials_select on materials;
create policy materials_select on materials for select to authenticated
  using (status = 'approved' or author_id = auth.uid() or is_teacher());
-- 发布：只能以自己身份发布；非教师只能发 pending，教师可直接 approved
drop policy if exists materials_insert on materials;
create policy materials_insert on materials for insert to authenticated
  with check (author_id = auth.uid() and (is_teacher() or status = 'pending'));
-- 审核（改状态）与删除：仅教师
drop policy if exists materials_update_teacher on materials;
create policy materials_update_teacher on materials for update to authenticated
  using (is_teacher()) with check (is_teacher());
drop policy if exists materials_delete_teacher on materials;
create policy materials_delete_teacher on materials for delete to authenticated
  using (is_teacher());

-- likes / favorites：只能管理自己的
drop policy if exists likes_select_own on likes;
create policy likes_select_own on likes for select to authenticated using (user_id = auth.uid());
drop policy if exists likes_insert_own on likes;
create policy likes_insert_own on likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists likes_delete_own on likes;
create policy likes_delete_own on likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists fav_select_own on favorites;
create policy fav_select_own on favorites for select to authenticated using (user_id = auth.uid());
drop policy if exists fav_insert_own on favorites;
create policy fav_insert_own on favorites for insert to authenticated with check (user_id = auth.uid());
drop policy if exists fav_delete_own on favorites;
create policy fav_delete_own on favorites for delete to authenticated using (user_id = auth.uid());

-- comments：登录用户都能看；只能以自己身份发评论
drop policy if exists comments_select on comments;
create policy comments_select on comments for select to authenticated using (true);
drop policy if exists comments_insert_own on comments;
create policy comments_insert_own on comments for insert to authenticated with check (user_id = auth.uid());

-- ---------------- 演示数据（素材/点赞/收藏/评论）----------------
-- 说明：演示作者不是真实登录账号，仅用于首页展示效果；真实互动以登录用户为准。
insert into materials (id,title,intro,content,source,author_id,author_name,author_role,status,created_at,approved_at,likes_count,favorites_count,comments_count) values
 ('aaaaaaaa-0000-0000-0000-000000000001','文化自信：从故宫文创说起','梳理“文化自信”的论证角度与可引用的案例素材，适合宏大主题类作文。','一、核心论点\n文化自信不是封闭自守，而是在开放中确认自身价值。\n二、可用案例\n1. 故宫文创：把文物“带回家”，让传统以年轻人喜欢的方式重生。\n2. 《只此青绿》：以舞蹈语汇激活《千里江山图》。','《人民日报》文化版','33333333-3333-3333-3333-333333333333','小红','student','approved',(extract(epoch from now())*1000)::bigint - 3600000::bigint*30*30, (extract(epoch from now())*1000)::bigint - 3600000::bigint*29*30, 2,1,1),
 ('aaaaaaaa-0000-0000-0000-000000000002','科技向善：人工智能的伦理边界','探讨科技发展中“善”的价值导向，可用于科技类、人文类作文。','一、立意\n技术本身无善恶，关键在于人的选择。\n二、论证思路\n1. 科技放大人性：善用则造福，滥用则反噬。\n2. 向善是底线也是方向：以“科技向善”约束创新。','高考满分作文选','22222222-2222-2222-2222-222222222222','小明','student','approved',(extract(epoch from now())*1000)::bigint - 3600000::bigint*20*30, (extract(epoch from now())*1000)::bigint - 3600000::bigint*19*30, 1,0,0),
 ('aaaaaaaa-0000-0000-0000-000000000003','坚守初心：论青年的责任担当','教师精选：关于“初心与担当”的多维素材与结构示范。','一、结构示范\n引：以时代之问开篇。\n议：初心为何物（价值层）。\n联：青年如何担当（实践层）。\n结：回扣主题，升华。\n二、可用人物\n黄文秀、张桂梅等扎根一线、不负初心的典型。','王老师教学整理','11111111-1111-1111-1111-111111111111','王老师','teacher','approved',(extract(epoch from now())*1000)::bigint - 3600000::bigint*10*30, (extract(epoch from now())*1000)::bigint - 3600000::bigint*9*30, 2,1,1),
 ('aaaaaaaa-0000-0000-0000-000000000004','生态文明：绿水青山就是金山银山','待审核示例素材：生态文明主题的论证角度。','一、核心\n生态保护与经济发展并非对立。\n二、案例\n浙江安吉余村转型。','网络整理','22222222-2222-2222-2222-222222222222','小明','student','pending',(extract(epoch from now())*1000)::bigint - 3600000::bigint*2*30, null, 0,0,0)
on conflict (id) do nothing;

insert into likes (user_id, material_id) values
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001'),
 ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001'),
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002'),
 ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000003'),
 ('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000003')
on conflict do nothing;

insert into favorites (user_id, material_id) values
 ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001'),
 ('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000003')
on conflict do nothing;

insert into comments (material_id, user_id, user_name, content, created_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','小明','案例很新，谢谢分享！',(extract(epoch from now())*1000)::bigint - 3600000::bigint*20*30),
 ('aaaaaaaa-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333','小红','老师给的框架很清晰！',(extract(epoch from now())*1000)::bigint - 3600000::bigint*8*30);

-- ============================================================
-- 执行完成后：
-- 1) Authentication → Providers → Email：关闭「Confirm email」(否则用户名注册无法登录)
-- 2) 让某人成为教师：先让他在网站注册一个账号，再来这里执行（把 teacher 换成他的用户名）：
--        update profiles set role = 'teacher' where username = 'teacher';
-- ============================================================
