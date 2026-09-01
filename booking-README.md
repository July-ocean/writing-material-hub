# 制备 / 半制备系统预约 · 上线说明

带账号体系：注册 → 登录 → 预约自己的时段 → 取消自己的时段，碰不到别人的。
**两台设备（制备 / 半制备）各自独立预约**，同一时段两台可以分别被两个人约走。
一周视图、1 小时一格、08:00–22:00、先到先得；预约时可勾选水相。
复用已有的 Supabase 项目 + GitHub Pages，不需要新增任何服务。

---

## 第 1 步：建表（只需做一次，必须做）

1. 打开 https://supabase.com/dashboard ，进入项目 `upcknogedaijbtrawsri`
2. 左侧菜单点 **SQL Editor** → **New query**
3. 把 `booking-schema.sql` 的全部内容粘贴进去
4. 点右下角 **Run**（或 Ctrl+Enter）
5. 看到 `Success. No rows returned` 即成功

脚本是**幂等**的：已经建过旧版表的，重跑一次即可升级（自动补 `user_id` 列、替换函数），
已有预约会保留，只是没有归属人（`user_id` 为空），需要本人认领或由你删除。

### 这一步都建了什么

| 对象 | 作用 |
|---|---|
| 表 `prep_users` | 用户名 / 显示姓名 / **bcrypt 密码哈希** |
| 表 `prep_sessions` | 登录会话，30 天有效 |
| 表 `prep_bookings` | 预约记录，主键 `id = '2026-09-07#08#prep'` |
| 主键唯一约束 | **同一设备同一时段只能一个人**；设备后缀让两台设备互不干扰 |
| RLS | `prep_bookings` 对 anon 只读；`prep_users` / `prep_sessions` **零权限** |
| 函数 `register_user` | 注册，密码用 bcrypt 加盐哈希后存储 |
| 函数 `login_user` | 校验密码，返回会话 token |
| 函数 `me` / `logout` | 恢复登录态 / 退出 |
| 函数 `book_slot` | 预约入口，按 `设备#时段` 锁主键；非法设备返回 `BAD_DEVICE` |
| 函数 `cancel_slot` | **按 `user_id` 匹配才能删除**，别人的预约物理上删不掉 |
| 函数 `my_bookings` | 跨周、**跨设备**返回本人名下全部未来机时 |

### 权限为什么是安全的

- 密码哈希**永远不会离开数据库**——`prep_users` 表对匿名用户零权限，前端查不到
- 所有写操作都收在 `security definer` 函数里，函数内部才做身份校验
- 取消用的是 `where id = ? and user_id = <会话里的用户>`。就算有人拿到链接、
  自己写请求去调 `cancel_slot`，只要不是本人的预约，一条都删不掉
- 排班表本身公开可读是**有意**的：大家要能看到谁约了什么，才好避让

---

## 第 2 步：推送到 GitHub（页面上线）

```bash
cd writing-material-hub
git add docs/booking/ booking-schema.sql booking-README.md
git commit -m "feat: 制备/半制备系统预约（含账号体系）"
git push origin master
```

推送后约 1–2 分钟生效。访问地址：

**https://july-ocean.github.io/writing-material-hub/booking/**

页面默认停在 **9/7（周一）– 9/13（周日）** 那一周（代码里 `OPEN_FROM` 控制），
之后会随日期自动切到当前周。

发群里建议用带参数的固定链接，锁死那一周：

```
https://july-ocean.github.io/writing-material-hub/booking/?week=2026-09-07
```

---

## 第 3 步：发群公告（可直接复制）

> 【制备/半制备系统预约】下周（9.7–9.13）的机时开放预约
>
> 链接：https://july-ocean.github.io/writing-material-hub/booking/?week=2026-09-07
>
> 第一次用先**注册**：填 用户名 + 真实姓名 + 密码（≥6 位）。
> 姓名会显示在预约格子上，请填真名。之后每次打开自动登录。
>
> · 顶部切换 **制备 / 半制备**，两台设备各自独立预约，互不占机时
> · 每天 08:00–22:00，1 小时一个时段，先约先得
> · 预约时可选填**水相**（0.05%盐酸 / 0.1%甲酸 / 其它自填）
> · 已被约的格子显示预约人姓名，且点不动；已开始的时段置灰
> · 取消：上方「我的预约」列表里点「取消」，或点自己约过的格子
> · 只能取消自己的，取消后时段立即释放给别人

---

## 大家怎么用

- **注册**：用户名（3–20 位字母数字）+ 真实姓名 + 密码（≥6 位）。注册完自动登录
- **切换设备**：页面顶部两个 Tab（制备 / 半制备）。两台设备机时**完全独立**，
  同一时段可以一边一个人；约之前先确认在正确的设备页
- **预约**：登录后点空格子 → 可勾选**水相**（0.05%盐酸 / 0.1%甲酸 / 其它自填）→
  可补充备注 → 确认。预约人自动取你的姓名，改不了
- **取消（两种方式）**
  1. 上方「我的预约」列表 → 点「取消」（推荐，跨周、**跨设备**汇总，不用翻页找）
  2. 直接点网格中自己约过的格子（蓝框、标「我的」）
- **撞车**：提示"手慢了，这个时段刚被别人约走"，说明同一秒有人比你快（**仅限同一设备**）
- **过期**：已开始的时段置灰，点不动；数据库侧同样拦截

---

## 日常运维

### 看某一周两台设备的排班

```sql
select day, hour, device, name, aqueous, note
from public.prep_bookings
where day between '2026-09-07' and '2026-09-13'
order by device, day, hour;
```

页面上的「复制本周排班」按钮会生成当前设备的文字版排班，可直接粘到群里。

### 看每台设备各被约了多少小时

```sql
select device, count(*) as 已约时段数
from public.prep_bookings group by device;
```

### 看所有已注册用户（不含密码）

```sql
select username, display_name, created_at
from public.prep_users order by created_at;
```

### 有人忘记密码

```sql
update public.prep_users
   set pass_hash = crypt('临时新密码', gen_salt('bf', 8))
 where username = 'liming';
```

让他登录后自行修改（当前页面暂无改密码入口，需要的话可以加）。

### 强制删除某个时段（绕过归属校验）

```sql
delete from public.prep_bookings where id = '2026-09-07#08#prep';
```

id 格式：`日期#两位小时#设备`，`08` 代表 8:00–9:00，`21` 代表 21:00–22:00；
设备是 `prep`（制备）或 `semi`（半制备）。

### 注销某个账号（连带删掉他的预约和会话）

```sql
delete from public.prep_users where username = 'liming';
```

外键是 `on delete cascade` / `on delete set null`，预约会自动清掉。

### 清空全部预约（保留账号）

```sql
truncate public.prep_bookings;
```

### 改开放起始日 / 时段范围

编辑 `docs/booking/index.html` 顶部的配置区：

```js
var OPEN_FROM = "2026-09-07";   // 默认定位到这一天所在周
var DAY_START = 8;              // 08:00 开始
var DAY_END   = 22;             // 22:00 结束（最后时段 21:00-22:00）
```

改成 2 小时一格的话，SQL 里 `book_slot` 的 `p_hour < 8 or p_hour > 21` 也要跟着改。

---

## 常见问题

**Q：建表之前能先看看效果吗？**
能，地址后面加 `?demo=1`：

```
https://july-ocean.github.io/writing-material-hub/booking/?demo=1&week=2026-09-07
```

演示模式用浏览器内存里的数据跑，注册、登录、预约、取消、撞车、越权拦截全流程都能点，
**不会真正保存**，刷新即恢复。默认已用 `李明（liming / 123456）` 登录，
点「退出」可换账号或体验注册。去掉 `?demo=1` 就是真实数据。

**Q：别人能取消我的预约吗？**
不能。取消按 `user_id` 匹配，和姓名无关。同名也互不影响——这正是做账号体系的原因。

**Q：两台设备能同时约吗？**
能，这正是设计意图。同一时段，制备和半制备可以分别被两个人约走；
只有「同一设备 + 同一时段」才互斥。主键 id 带设备后缀（如 `2026-09-07#08#prep`），
从数据库层面保证了互不干扰。

**Q：别人能看到我的密码吗？**
不能。`prep_users` 表对匿名用户零权限，密码是 bcrypt 哈希，连你自己都查不回明文。

**Q：能约下周以后的吗？**
能，「下一周 →」可以一直往后翻，数据按周拉取，没有上限。

**Q：手机上怎么看？**
手机自动切成单日视图：顶部一条日期切换条（有预约的日子会标蓝点），
下面列出那天的 14 个时段。电脑上则是完整的 7 天 × 14 小时网格。

**Q：为什么我点格子没反应？**
三种情况：格子已被别人约了（显示对方姓名）、时段已开始（置灰）、还没登录。
前两种是正常限制，第三种会弹出登录框。

**Q：加载失败 / 提示数据库未初始化？**
第 1 步的 SQL 没跑成功。回 Supabase 的 SQL Editor 看报错。

**Q：GitHub Pages 打不开？**
仓库 Settings → Pages，确认 Source 是 `master` 分支的 `/docs` 目录。
