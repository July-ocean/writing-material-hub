-- 作文素材坊 · 数据库结构（在 Supabase 的 SQL Editor 中全选执行一次）
-- 适用于 Supabase / 任意 Postgres。演示账号密码均为 123456。

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password text not null,
  role text not null,
  display_name text not null,
  created_at bigint not null
);

create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  intro text not null,
  content text not null,
  source text not null,
  author_id uuid,
  author_name text,
  author_role text,
  status text not null default 'pending',
  created_at bigint not null,
  approved_at bigint,
  likes_count int not null default 0,
  favorites_count int not null default 0,
  comments_count int not null default 0
);

create table if not exists likes (
  user_id uuid not null,
  material_id uuid not null,
  primary key (user_id, material_id)
);

create table if not exists favorites (
  user_id uuid not null,
  material_id uuid not null,
  primary key (user_id, material_id)
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null,
  user_id uuid,
  user_name text,
  content text not null,
  created_at bigint not null
);

create table if not exists sessions (
  token text primary key,
  user_id uuid not null
);

-- ---------------- 演示数据 ----------------
insert into users (id, username, password, role, display_name, created_at) values
 ('11111111-1111-1111-1111-111111111111','teacher','a1b2c3d4e5f6a7b8:91fb2b7834fb1ab226efed019f384f4fd2feff8dff6a966ca68497b4528b22dbd46f0661c294ad6a4edaa2c904c4f58c6d17bc7fd897a044b555c687120a576d','teacher','王老师',(extract(epoch from now())*1000)::bigint),
 ('22222222-2222-2222-2222-222222222222','student','a1b2c3d4e5f6a7b8:91fb2b7834fb1ab226efed019f384f4fd2feff8dff6a966ca68497b4528b22dbd46f0661c294ad6a4edaa2c904c4f58c6d17bc7fd897a044b555c687120a576d','student','小明',(extract(epoch from now())*1000)::bigint),
 ('33333333-3333-3333-3333-333333333333','xiaohong','a1b2c3d4e5f6a7b8:91fb2b7834fb1ab226efed019f384f4fd2feff8dff6a966ca68497b4528b22dbd46f0661c294ad6a4edaa2c904c4f58c6d17bc7fd897a044b555c687120a576d','student','小红',(extract(epoch from now())*1000)::bigint)
on conflict (username) do nothing;

insert into materials (id,title,intro,content,source,author_id,author_name,author_role,status,created_at,approved_at,likes_count,favorites_count,comments_count) values
 ('aaaaaaaa-0000-0000-0000-000000000001','文化自信：从故宫文创说起','梳理“文化自信”的论证角度与可引用的案例素材，适合宏大主题类作文。','一、核心论点\n文化自信不是封闭自守，而是在开放中确认自身价值。\n二、可用案例\n1. 故宫文创：把文物“带回家”，让传统以年轻人喜欢的方式重生。\n2. 《只此青绿》：以舞蹈语汇激活《千里江山图》。','《人民日报》文化版','33333333-3333-3333-3333-333333333333','小红','student','approved',(extract(epoch from now())*1000)::bigint - 3600000::bigint*30*30, (extract(epoch from now())*1000)::bigint - 3600000::bigint*29*30, 2,1,1),
 ('aaaaaaaa-0000-0000-0000-000000000002','科技向善：人工智能的伦理边界','探讨科技发展中“善”的价值导向，可用于科技类、人文类作文。','一、立意\n技术本身无善恶，关键在于人的选择。\n二、论证思路\n1. 科技放大人性：善用则造福，滥用则反噬。\n2. 向善是底线也是方向：以“科技向善”约束创新。','高考满分作文选','22222222-2222-2222-2222-222222222222','小明','student','approved',(extract(epoch from now())*1000)::bigint - 3600000::bigint*20*30, (extract(epoch from now())*1000)::bigint - 3600000::bigint*19*30, 1,0,0),
 ('aaaaaaaa-0000-0000-0000-000000000003','坚守初心：论青年的责任担当','教师精选：关于“初心与担当”的多维素材与结构示范。','一、结构示范\n引：以时代之问开篇。\n议：初心为何物（价值层）。\n联：青年如何担当（实践层）。\n结：回扣主题，升华。\n二、可用人物\n黄文秀、张桂梅等扎根一线、不负初心的典型。','王老师教学整理','11111111-1111-1111-1111-111111111111','王老师','teacher','approved',(extract(epoch from now())*1000)::bigint - 3600000::bigint*10*30, (extract(epoch from now())*1000)::bigint - 3600000::bigint*9*30, 2,1,1),
 ('aaaaaaaa-0000-0000-0000-000000000004','生态文明：绿水青山就是金山银山','待审核示例素材：生态文明主题的论证角度。','一、核心\n生态保护与经济发展并非对立。\n二、案例\n浙江安吉余村转型。','网络整理','22222222-2222-2222-2222-222222222222','小明','student','pending',(extract(epoch from now())*1000)::bigint - 3600000::bigint*2*30, null, 0,0,0);

insert into likes (user_id, material_id) values
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001'),
 ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001'),
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002'),
 ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000003'),
 ('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000003');

insert into favorites (user_id, material_id) values
 ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001'),
 ('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000003');

insert into comments (material_id, user_id, user_name, content, created_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','小明','案例很新，谢谢分享！',(extract(epoch from now())*1000)::bigint - 3600000::bigint*20*30),
 ('aaaaaaaa-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333','小红','老师给的框架很清晰！',(extract(epoch from now())*1000)::bigint - 3600000::bigint*8*30);

-- ---------------- 行级安全（RLS）----------------
-- 本应用由 Node 服务器使用 service_role 密钥访问，service_role 会自动绕过 RLS，
-- 因此启用 RLS 不影响应用功能；此处启用仅为安全加固：
-- 万一 anon / authenticated 密钥泄露，也无法直接读写这些表。
alter table users enable row level security;
alter table materials enable row level security;
alter table likes enable row level security;
alter table favorites enable row level security;
alter table comments enable row level security;
alter table sessions enable row level security;
