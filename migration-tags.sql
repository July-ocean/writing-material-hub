-- ============================================================
-- 迁移脚本：为「素材」增加标签(tags)功能
-- 适用：数据库里已经有真实数据、不想重置的情况。
-- 用法：Supabase 控制台 → SQL Editor → 全选粘贴 → 执行一次即可。
-- 本脚本只「新增列 + 给已有素材补标签」，不会删除任何数据，可安全重复执行。
-- ============================================================

-- 1) 给 materials 表增加 tags 列（若已存在则跳过）
alter table materials add column if not exists tags text[] not null default '{}';

-- 2) 给现有 4 条演示素材补上标签（按标题匹配，不覆盖已手动改过的其它素材）
update materials set tags = ARRAY['文化自信','传统文化','家国情怀','时代精神']
  where title = '文化自信：从故宫文创说起';
update materials set tags = ARRAY['科技创新','时代精神','责任奉献']
  where title = '科技向善：人工智能的伦理边界';
update materials set tags = ARRAY['青年担当','理想信念','责任奉献','奋斗拼搏']
  where title = '坚守初心：论青年的责任担当';
update materials set tags = ARRAY['生态文明','家国情怀','人生哲理']
  where title = '生态文明：绿水青山就是金山银山';

-- 完成。之后学生/教师在发布素材时选择或自定义的标签会自动写入此列。
-- ============================================================
