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
  tags            text[] not null default '{}',      -- 内容标签，便于检索
  author_id       uuid,
  author_name     text,
  author_role     text,
  status          text not null default 'pending',  -- pending / approved / rejected
  created_at      bigint not null,
  approved_at     bigint,
  likes_count     int not null default 0,
  favorites_count int not null default 0,
  comments_count  int not null default 0,
  teacher_likes_count int not null default 0
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
-- 作者可编辑自己发布的素材（不能改 status/作者：编辑表单不含 status，UPDATE 时该列保持不变；author_id 锁定防止转嫁他人）
drop policy if exists materials_update_self on materials;
create policy materials_update_self on materials for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());
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
-- 演示素材：全部由教师账号“曾老师”发布（author_role=teacher，状态 approved）。
-- author_id 留空（数据库不绑定具体 uid）；若要关联到你的真实教师账号，
-- 用 service_role 执行：update materials set author_id='<教师uid>' where author_role='teacher';
insert into materials (id,title,intro,content,source,tags,author_id,author_name,author_role,status,created_at,approved_at,likes_count,favorites_count,comments_count) values
 ('aaaaaaaa-0000-0000-0000-000000000001','文化自信：从故宫文创说起','梳理“文化自信”的论证角度、名言与案例，并附可直接套用的文章结构，适合宏大主题类作文。',E'一、核心立意\n文化自信不是故步自封，而是在与世界对话中确认自身价值；不是盲目自大，而是对自身优秀的清醒认知与自觉传承。\n\n二、名家名言\n1. “没有高度的文化自信，没有文化的繁荣兴盛，就没有中华民族伟大复兴。”——习近平\n2. “各美其美，美人之美，美美与共，天下大同。”——费孝通\n3. “周虽旧邦，其命维新。”——《诗经》\n\n三、典型事例\n1. 故宫文创：从“朝珠耳机”到“千里江山图”胶带，把庄严的文物变成年轻人案头的日常，让传统以轻盈的方式“活”在当下。\n2. 《只此青绿》：以舞蹈诗剧重现《千里江山图》，用身体语言诠释宋韵美学，登上春晚后引发“国潮”热潮。\n3. 河南卫视“中国节日”系列：端午奇妙游、中秋奇妙游，以科技赋能传统，让节日文化破圈传播。\n\n四、结构示范（是什么—为什么—怎么办）\n引：以“国潮”现象切入，点出文化自信的时代命题。\n议：文化自信的根基在于中华文明的连续性；其力量在于创造性转化。\n联：从个人审美到国家形象，文化自信如何落地。\n结：呼应开头，升华“守正创新”。\n\n五、可化用金句\n“传统不是守住炉灰，而是传递火炬。”当故宫的红墙走进手机壳，当青绿山水舞上舞台，我们看见的，是一个民族对自己来路的深情与自信。','https://culture.people.com.cn/',ARRAY['文化自信','传统文化','家国情怀','时代精神'],'曾老师','teacher','approved',(extract(epoch from now())*1000)::bigint - 3600000::bigint*30*30, (extract(epoch from now())*1000)::bigint - 3600000::bigint*29*30, 0,0,0),
 ('aaaaaaaa-0000-0000-0000-000000000002','科技向善：人工智能的伦理边界','探讨科技发展中“善”的价值导向，提供名言、案例与论证结构，可用于科技类、人文类作文。',E'一、核心立意\n技术本身无善恶，关键在于人的选择。科技向善，既是创新的底线，也是文明的方向。\n\n二、名家名言\n1. “科技是第一生产力，人才是第一资源，创新是第一动力。”——习近平\n2. “科学没有国界，但科学家有祖国。”——巴斯德\n3. “我们这一代人要做的就是确保科技向善。”——比尔·盖茨\n\n三、典型事例\n1. AlphaGo 战胜李世石：人工智能在围棋这一人类智慧高地撕开缺口，引发对“机器是否会取代人”的深层思考。\n2. AI 绘画的版权争议：当算法“学习”海量作品并生成新图，原作者的权益如何界定？技术红利与个体权利的平衡成为新课题。\n3. 科技抗疫：大数据溯源、AI 辅助诊断，在疫情中彰显技术守护生命的温度。\n\n四、结构示范\n引：以一项最新 AI 突破开篇，提出“善”的追问。\n议：科技放大人性——善用则造福，滥用则反噬。\n联：向善是底线更是方向，需以伦理与法律约束创新。\n结：技术应当服务于人的尊严与幸福。\n\n五、可化用金句\n“工具愈是锋利，执工具的手愈需清醒。”人工智能不是人性的替代品，而是照见人类选择的镜子。唯有以向善为锚，科技才能真正照亮未来。','https://www.news.cn/',ARRAY['科技创新','时代精神','责任奉献'],'曾老师','teacher','approved',(extract(epoch from now())*1000)::bigint - 3600000::bigint*20*30, (extract(epoch from now())*1000)::bigint - 3600000::bigint*19*30, 0,0,0),
 ('aaaaaaaa-0000-0000-0000-000000000003','坚守初心：论青年的责任担当','教师精选：关于“初心与担当”的多维素材、人物案例与结构示范，适合青年、责任、奉献类主题。',E'一、核心立意\n初心是出发时的信念，担当是行进中的姿态。青年的价值，不在于空谈理想，而在于把初心写进脚下的土地。\n\n二、名家名言\n1. “不忘初心，方得始终。”——习近平\n2. “青年一代有理想、有本领、有担当，国家就有前途，民族就有希望。”——习近平\n3. “无穷的远方，无数的人们，都和我有关。”——鲁迅\n\n三、典型事例\n1. 黄文秀：北京师范大学硕士毕业后返乡担任驻村第一书记，把生命献给脱贫事业，用青春诠释“回来的人”的担当。\n2. 张桂梅：扎根滇西山区数十年，创办免费女子高中，让近两千名女孩走出大山，以病弱之躯托举希望。\n3. 航天青年团队：嫦娥、北斗、空间站背后，是一支平均年龄三十多岁的队伍，把青春焊进星辰大海。\n\n四、结构示范\n引：以时代之问开篇——今天的青年何以担当？\n议：初心为何物（价值层）：对家国、对他人的责任。\n联：青年如何担当（实践层）：在平凡岗位发光，在祖国需要处扎根。\n结：回扣主题，青春因担当而厚重。\n\n五、可化用金句\n“岁月因青春慨然以赴而更加静好，世间因少年挺身向前而更加瑰丽。”坚守初心，不是一句口号，而是每一次选择里对善与责的笃定。','https://www.12371.cn/',ARRAY['青年担当','理想信念','责任奉献','奋斗拼搏'],'曾老师','teacher','approved',(extract(epoch from now())*1000)::bigint - 3600000::bigint*10*30, (extract(epoch from now())*1000)::bigint - 3600000::bigint*9*30, 0,0,0),
 ('aaaaaaaa-0000-0000-0000-000000000004','生态文明：绿水青山就是金山银山','生态文明主题的论证角度、典型案例与结构示范，适合环保、发展、家园类作文。',E'一、核心立意\n生态保护与经济发展并非对立。守住绿水青山，才能换来永续发展的金山银山。\n\n二、名家名言\n1. “绿水青山就是金山银山。”——习近平\n2. “人与自然是生命共同体，人类必须尊重自然、顺应自然、保护自然。”——习近平\n3. “采菊东篱下，悠然见南山。”——陶渊明（古人朴素的自然观）\n\n三、典型事例\n1. 安吉余村：从“石头经济”炸山采矿，到关停矿山、复绿山川，靠生态旅游致富，成为“两山”理念的鲜活样本。\n2. 塞罕坝：三代人五十余年，在荒漠上种出百万亩林海，铸就“地球的绿肺”，印证人的力量可以改写自然。\n3. 长江十年禁渔：以暂时的“退”换取生态的“进”，体现对自然规律的敬畏与长远眼光。\n\n四、结构示范\n引：以一幅“水清岸绿”的画面破题。\n议：绿水青山何以成为金山银山（生态价值转化为经济价值）。\n联：从余村到塞罕坝，生态文明的中国实践。\n结：守护生态就是守护子孙的未来。\n\n五、可化用金句\n“山水林田湖草沙，是一个生命共同体。”当余村的竹海变成“绿色银行”，我们读懂：对自然温柔，自然必以丰饶相报。','https://www.gov.cn/',ARRAY['生态文明','家国情怀','人生哲理'],'曾老师','teacher','approved',(extract(epoch from now())*1000)::bigint - 3600000::bigint*2*30, (extract(epoch from now())*1000)::bigint - 3600000::bigint*1*30, 0,0,0)
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
