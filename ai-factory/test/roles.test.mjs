import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROLE_PROFILES, ROLE_CATALOG, validateRoleProfile, validateRoleProfiles } from '../lib/roles.mjs';

test('role defaults select explicit Codex models, efforts and the matching role skill', () => {
  assert.deepEqual(validateRoleProfiles(DEFAULT_ROLE_PROFILES), {
    analyst: { model: 'gpt-6.1-sol', reasoning_effort: 'medium', skills: ['royal-analysis'] },
    developer: { model: 'gpt-6.1-sol', reasoning_effort: 'high', skills: ['royal-development'] },
    tester: { model: 'gpt-6.1-sol', reasoning_effort: 'high', skills: ['royal-testing'] },
  });
  const result = validateRoleProfiles(DEFAULT_ROLE_PROFILES);
  result.analyst.skills.length = 0;
  assert.deepEqual(DEFAULT_ROLE_PROFILES.analyst.skills, ['royal-analysis']);
  assert.ok(Object.isFrozen(ROLE_CATALOG.models[0].reasoning_efforts));
});

test('each supported model and effort can be selected, and skills can be explicitly disabled', () => {
  for (const role of ROLE_CATALOG.roles) for (const model of ROLE_CATALOG.models) for (const effort of model.reasoning_efforts) {
    const profile = { model: model.id, reasoning_effort: effort, skills: [] };
    assert.deepEqual(validateRoleProfile(role.id, profile), profile);
  }
});

test('profiles reject incomplete or unknown roles and hidden configuration fields', () => {
  for (const value of [null, [], {}, { analyst: DEFAULT_ROLE_PROFILES.analyst },
    { ...DEFAULT_ROLE_PROFILES, release: DEFAULT_ROLE_PROFILES.analyst },
    { ...DEFAULT_ROLE_PROFILES, arbitrary: {} }]) {
    assert.throws(() => validateRoleProfiles(value), { status: 400 });
  }
  assert.throws(() => validateRoleProfile('release', DEFAULT_ROLE_PROFILES.analyst), { status: 400 });
  for (const profile of [null, [], {}, { ...DEFAULT_ROLE_PROFILES.analyst, api_key: 'unwanted' },
    { ...DEFAULT_ROLE_PROFILES.analyst, model: 'provider/arbitrary' },
    { ...DEFAULT_ROLE_PROFILES.analyst, reasoning_effort: 'infinite' },
    { ...DEFAULT_ROLE_PROFILES.analyst, skills: ['royal-testing'] },
    { ...DEFAULT_ROLE_PROFILES.analyst, skills: ['../skills/external'] },
    { ...DEFAULT_ROLE_PROFILES.analyst, skills: ['royal-analysis', 'royal-analysis'] },
    { ...DEFAULT_ROLE_PROFILES.analyst, skills: new Array(1) },
    { ...DEFAULT_ROLE_PROFILES.analyst, skills: 'royal-analysis' }]) {
    assert.throws(() => validateRoleProfile('analyst', profile), { status: 400 });
  }
});
