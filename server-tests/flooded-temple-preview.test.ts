import test from 'node:test';
import assert from 'node:assert/strict';
import {templePreviewCookies} from '../scripts/temple-preview-cookies';

test('local device preview cookie isolation preserves earlier stand cookies and backend cookie attributes',()=>{
  const cookies=templePreviewCookies('temple_devices_5233');
  assert.equal(cookies.request('royal_session=earlier-stand; theme=dark'),'theme=dark');
  assert.equal(cookies.request('royal_session=earlier-stand; royal_session_temple_devices_5233=current-stand; theme=dark'),'royal_session=current-stand; theme=dark');
  const original=['royal_session=current-stand; HttpOnly; Path=/; SameSite=Lax; Max-Age=100','other=unchanged'];
  assert.deepEqual(cookies.response(original),['royal_session_temple_devices_5233=current-stand; HttpOnly; Path=/; SameSite=Lax; Max-Age=100','other=unchanged']);
  assert.equal(original[0],'royal_session=current-stand; HttpOnly; Path=/; SameSite=Lax; Max-Age=100');
  assert.deepEqual(cookies.response(['royal_session=; Path=/; Max-Age=0']),['royal_session_temple_devices_5233=; Path=/; Max-Age=0']);
  assert.throws(()=>templePreviewCookies('not a cookie name'));
});

test('existing preview behavior stays byte-identical without an explicit namespace',()=>{
  const cookies=templePreviewCookies(),header='royal_session=existing; theme=dark',response=['royal_session=existing; HttpOnly; Path=/'];
  assert.equal(cookies.request(header),header);assert.equal(cookies.response(response),response);assert.equal(cookies.request(undefined),undefined);
});
