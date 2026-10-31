import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyLogs} from '../src/desktop-evidence.mjs';
const base='http://127.0.0.1:18888/backend-api/codex';
test('evidence identifies only matching route and retains UI/long-term limits',()=>{
  const result=classifyLogs([{feedback_log_body:`transport="responses_http" method=POST url="${base}/responses" status=200`}],base);
  assert.equal(result.routeObserved,true);assert.equal(result.cleanObservedWindow,true);
  assert.equal(result.desktopUiVerified,false);assert.equal(result.longTermStabilityVerified,false);
});
test('other thread route or missing data cannot pass route evidence',()=>{
  assert.equal(classifyLogs([],base).routeObserved,false);
  assert.equal(classifyLogs([{feedback_log_body:'transport="responses_http" status=200 url="https://example.invalid"'}],base).routeObserved,false);
});
test('errors/reconnects invalidate clean window without leaking log bodies',()=>{
  const r=classifyLogs([{feedback_log_body:`transport="responses_http" url="${base}/responses" status=200`},
    {feedback_log_body:`transport="responses_http" url="${base}/responses" status=429 private-text`},
    {feedback_log_body:'stream disconnected before completion: websocket closed by server before response.completed'}],base);
  assert.equal(r.cleanObservedWindow,false);assert.equal(r.httpOther,1);assert.equal(r.websocketEvents,1);
  assert.doesNotMatch(JSON.stringify(r),/private-text/);
});
