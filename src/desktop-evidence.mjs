import path from 'node:path';
import {lstat} from 'node:fs/promises';

export function classifyLogs(rows,baseUrl) {
  const result={rowsExamined:rows.length,http200:0,httpOther:0,websocketEvents:0,reconnectEvents:0};
  for(const {feedback_log_body:body} of rows) {
    if(typeof body!=='string') continue;
    if(body.includes('responses_http')&&body.includes(baseUrl+'/responses')) {
      if(/(?:status|status_code|http\.response\.status_code)\s*=\s*"?200\b/.test(body)) result.http200++;
      else if(/(?:status|status_code|http\.response\.status_code)\s*=\s*"?[345]\d\d\b/.test(body)) result.httpOther++;
    }
    if(/websocket closed by server|websocket.*(?:connect|connected).*wss:\/\//i.test(body)) result.websocketEvents++;
    if(/stream disconnected before completion|Reconnecting \d|retrying stream/i.test(body)) result.reconnectEvents++;
  }
  return {...result,routeObserved:result.http200>0,cleanObservedWindow:result.http200>0&&result.httpOther===0&&result.websocketEvents===0&&result.reconnectEvents===0,
    desktopUiVerified:false,longTermStabilityVerified:false};
}

// Optional, read-only, bounded local evidence. No log bodies or chat IDs in output.
export async function desktopEvidence(codexHome,{threadId,since,baseUrl}) {
  if(!/^[a-f0-9-]{36}$/i.test(threadId??'')||!since||!Number.isFinite(Date.parse(since)))
    throw new Error('desktop-evidence requires --thread-id UUID and --since ISO timestamp after desktop restart.');
  const file=path.join(codexHome,'logs_2.sqlite');
  if(!(await lstat(file)).isFile()) throw new Error('Expected a regular local logs database.');
  const sqlite=await import('node:sqlite');
  if(!sqlite.DatabaseSync) throw new Error('This Node version lacks the tested SQLite API.');
  const db=new sqlite.DatabaseSync(file,{readOnly:true});
  try {
    const columns=db.prepare('PRAGMA table_info(logs)').all().map(c=>c.name);
    if(!['id','ts','thread_id','feedback_log_body'].every(c=>columns.includes(c))) throw new Error('Unsupported local logs schema; evidence unavailable.');
    const rows=db.prepare('SELECT feedback_log_body FROM logs WHERE thread_id = ? AND ts >= ? ORDER BY id DESC LIMIT 10001')
      .all(threadId,Math.floor(Date.parse(since)/1000));
    if(rows.length>10000) throw new Error('Evidence window too large; choose a more recent --since value.');
    return classifyLogs(rows,baseUrl);
  } finally {db.close();}
}
