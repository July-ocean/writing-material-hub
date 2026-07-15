-- ============================================================
-- 迁移脚本：允许用户编辑自己发布的素材
-- 适用：数据库里已经有真实数据、不想重置的情况。
-- 用法：Supabase 控制台 → SQL Editor → 全选粘贴 → 执行一次即可。
-- 说明：仅新增一条 RLS 更新策略（作者可改自己的素材），不删任何数据，可重复执行。
-- ============================================================

-- 作者可编辑自己发布的素材：
--   USING   → 只能改 author_id = 当前用户 的素材
--   WITH CHECK → 更新后 author_id 仍必须是自己（防止把素材转嫁给别人）
-- 注意：编辑表单不含 status 字段，UPDATE 时 status/作者 自动保持不变，
--       不会因学生自行编辑而绕过教师审核。
drop policy if exists materials_update_self on materials;
create policy materials_update_self on materials for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- 完成。之后在自己的素材详情里点「编辑」即可修改标题/简介/内容/来源/标签。
-- ============================================================
