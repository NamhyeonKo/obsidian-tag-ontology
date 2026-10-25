import assert from 'node:assert/strict';
import test from 'node:test';
import { serialize } from '../src/dictionary.ts';

// The user's dictionary is written one entry per line, keys in code point order, empty aliases left out.
const userStyle = '{\n'
  + '"absinthe": {"description": "Blind SQL Injection 데이터 추출 자동화 도구", "broader": ["vulnerability-scanning"]},\n'
  + '"agile": {"aliases": ["애자일"], "description": "짧은 주기로 개발하는 접근", "broader": ["sdlc"], "related": ["project-management"]},\n'
  + '"ai": {"aliases": ["인공지능", "Artificial Intelligence"], "description": "AI", "broader": [], "facet": "field", "extra": {"a": [1, 2]}}\n'
  + '}\n';

test('serialize reproduces a file written one entry per line byte for byte', () => {
  assert.equal(serialize(JSON.parse(userStyle)), userStyle);
});

test('serialize sorts keys by code point and writes an empty dictionary as two lines', () => {
  assert.equal(serialize({ b: { description: '' }, B: { description: '' }, a: { description: '' } }).split('\n').slice(1, 4).map(l => l.slice(0, 4)).join(), '"B":,"a":,"b":');
  assert.equal(serialize({}), '{\n}\n');
});
