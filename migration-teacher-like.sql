-- ============================================================
-- 迁移脚本：①校准计数 ②新增「教师点赞数」字段并维护
-- 在 Supabase 控制台 SQL Editor「全选粘贴、执行一次」即可。
-- 安全：只更新统计值 / 加列，不删除任何数据，可重复执行（幂等）。
-- ============================================================

-- ① 新增「教师点赞数」列（用于素材卡片展示「老师赞了」）
alter table materials add column if not exists teacher_likes_count int not null default 0;

-- ② 升级计数触发器：点赞者若为教师，额外累计 teacher_likes_count
create or replace function bump_counts() returns trigger
  language plpgsql security definer
  set search_path = public
as $$
declare t_role text;
begin
  if TG_TABLE_NAME = 'likes' then
    if TG_OP = 'INSERT' then
      update materials set likes_count = likes_count + 1 where id = NEW.material_id;
      select role into t_role from profiles where id = NEW.user_id;
      if t_role = 'teacher' then
        update materials set teacher_likes_count = teacher_likes_count + 1 where id = NEW.material_id;
      end if;
    elsif TG_OP = 'DELETE' then
      update materials set likes_count = greatest(likes_count - 1, 0) where id = OLD.material_id;
      select role into t_role from profiles where id = OLD.user_id;
      if t_role = 'teacher' then
        update materials set teacher_likes_count = greatest(teacher_likes_count - 1, 0) where id = OLD.material_id;
      end if;
    end if;
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

-- ③ 用真实关联表统计覆盖失真的 likes_count / favorites_count / comments_count
--    （修掉「种子预置值 + 触发器累加」导致的双重计数）
update materials m set
  likes_count     = (select count(*) from likes     l where l.material_id = m.id),
  favorites_count = (select count(*) from favorites f where f.material_id = m.id),
  comments_count  = (select count(*) from comments  c where c.material_id = m.id),
  teacher_likes_count = (select count(*) from likes l join profiles p on p.id = l.user_id
                         where l.material_id = m.id and p.role = 'teacher');
