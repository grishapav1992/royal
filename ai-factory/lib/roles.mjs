function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export const ROLE_CATALOG = freeze({
  roles: [
    { id: 'analyst', name: 'Аналитик', description: 'Изучает задачу, задает вопросы и готовит критерии приемки.', skills: ['royal-analysis'], timeout_minutes: 15 },
    { id: 'developer', name: 'Разработчик', description: 'Реализует требования и исправляет найденные ошибки.', skills: ['royal-development'], timeout_minutes: 45 },
    { id: 'tester', name: 'Тестировщик', description: 'Проверяет результат разработки и воспроизводит ошибки.', skills: ['royal-testing'], timeout_minutes: 30 },
  ],
  models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'].map((id) => ({ id, name: id, reasoning_efforts: ['low', 'medium', 'high', 'xhigh'] })),
  skills: [
    { id: 'royal-analysis', role: 'analyst', name: 'Анализ задач Рояля', description: 'Требования, вопросы, декомпозиция и критерии приемки.' },
    { id: 'royal-development', role: 'developer', name: 'Разработка Рояля', description: 'Реализация согласованных требований и исправление дефектов.' },
    { id: 'royal-testing', role: 'tester', name: 'Проверка Рояля', description: 'Независимая проверка требований, изменений и игровых сценариев.' },
  ],
});

export const ROLE_TIMEOUT_MS = freeze(Object.fromEntries(ROLE_CATALOG.roles.map(({ id, timeout_minutes }) => [id, timeout_minutes * 60000])));
export const BUG_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low']);

export const DEFAULT_ROLE_PROFILES = freeze({
  analyst: { model: 'gpt-6.1-sol', reasoning_effort: 'medium', skills: ['royal-analysis'] },
  developer: { model: 'gpt-6.1-sol', reasoning_effort: 'high', skills: ['royal-development'] },
  tester: { model: 'gpt-6.1-sol', reasoning_effort: 'high', skills: ['royal-testing'] },
});

export class RoleProfileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoleProfileError';
    this.status = 400;
    this.code = 'invalid_role_profile';
  }
}

function exactObject(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new RoleProfileError(`${name} must be an object`);
  }
  const present = Reflect.ownKeys(value);
  if (present.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))
    || present.some((key) => !keys.includes(key))) {
    throw new RoleProfileError(`${name} must contain exactly ${keys.join(', ')}`);
  }
}

export function validateRoleProfile(role, value) {
  const entry = ROLE_CATALOG.roles.find((item) => item.id === role);
  if (!entry) throw new RoleProfileError('Unknown configurable executor role');
  exactObject(value, ['model', 'reasoning_effort', 'skills'], `${role} profile`);
  const model = ROLE_CATALOG.models.find((item) => item.id === value.model);
  if (!model) throw new RoleProfileError('Unknown Codex model');
  if (!model.reasoning_efforts.includes(value.reasoning_effort)) throw new RoleProfileError('Unsupported reasoning effort for this model');
  if (!Array.isArray(value.skills) || value.skills.length > entry.skills.length
    || [...value.skills].some((skill) => typeof skill !== 'string' || !entry.skills.includes(skill))
    || new Set(value.skills).size !== value.skills.length) {
    throw new RoleProfileError('Skills must be unique catalog skills belonging to this role');
  }
  return { model: value.model, reasoning_effort: value.reasoning_effort, skills: [...value.skills] };
}

export function validateRoleProfiles(value) {
  const roles = ROLE_CATALOG.roles.map(({ id }) => id);
  exactObject(value, roles, 'role_profiles');
  return Object.fromEntries(roles.map((role) => [role, validateRoleProfile(role, value[role])]));
}
