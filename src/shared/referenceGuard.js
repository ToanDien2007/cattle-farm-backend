'use strict';
// Đăng ký "ai đang tham chiếu tới thực thể X" để quyết định xóa cứng hay xóa mềm / chặn xóa.
// Module phụ thuộc (health, vaccination, production...) gọi register('Cattle', 'tiêm phòng', async (ids) => ({ [id]: n })).
const registry = new Map();

function register(entity, label, countFn) {
  if (!registry.has(entity)) registry.set(entity, []);
  registry.get(entity).push({ label, countFn });
}

// -> { [id]: [{ label, count }] } chỉ gồm id có ít nhất 1 tham chiếu
async function referencesOf(entity, ids) {
  const out = {};
  for (const { label, countFn } of registry.get(entity) || []) {
    const counts = await countFn(ids.map(String));
    for (const [id, count] of Object.entries(counts || {})) {
      if (count > 0) (out[id] ||= []).push({ label, count });
    }
  }
  return out;
}

const describe = (refs) => refs.map((r) => `${r.count} ${r.label}`).join(', ');

module.exports = { register, referencesOf, describe };
