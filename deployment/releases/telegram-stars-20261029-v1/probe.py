"""Set up the authorized bot and create one unpaid owner invoice. Never confirms payment."""
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path('/opt/royal-releases/telegram-stars-20261029-v1')

NODE = r"""
import fs from 'node:fs';
import {createHmac,createHash} from 'node:crypto';
const operation=OPERATION, saved=SAVED;
const env=process.env, account=env.TELEGRAM_STARS_TRIAL_ACCOUNT_IDS;
if(env.TELEGRAM_STARS_ENABLED!=='true'||env.TELEGRAM_STARS_TRIAL!=='true'||!/^[-a-f0-9]{36}$/.test(account)
  ||env.TELEGRAM_STARS_USDT_UNITS_PER_STAR!=='10000')throw Error('Owner probe configuration differs');
const accountHash=createHash('sha256').update(account).digest('hex');
if(saved.accountHash&&saved.accountHash!==accountHash)throw Error('Probe account changed');
async function bot(method,body={}){
  try{
    const response=await fetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/'+method,
      {method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const row=await response.json();if(!response.ok||!row.ok)throw Error();return row.result;
  }catch{throw Error('Telegram operation was not confirmed');}
}
async function api(action,value){
  const path='/internal/users/'+account+'/'+action, method=value===undefined?'GET':'POST';
  const timestamp=String(Date.now()), body=value===undefined?'':JSON.stringify(value);
  const secret=fs.readFileSync(env.PAYMENTS_REQUEST_SECRET_FILE,'utf8').trim();
  const signature=createHmac('sha256',secret).update(['request',timestamp,method,path,body].join('\n')).digest('hex');
  const response=await fetch('http://127.0.0.1:2570'+path,{method,body:body||undefined,redirect:'error',signal:AbortSignal.timeout(8000),
    headers:{'Content-Type':'application/json','x-royal-payments-timestamp':timestamp,'x-royal-payments-signature':signature}});
  const row=await response.json();if(!response.ok)throw Error('Private payment API did not confirm the operation');return row;
}
if(operation==='setup'){
  const identity=await bot('getMe');
  if(identity.username.toLowerCase()!==env.TELEGRAM_BOT_USERNAME.toLowerCase()
    ||String(identity.id)!==env.TELEGRAM_BOT_TOKEN.split(':')[0])throw Error('Bot identity differs');
  const expected=new URL('/api/telegram-stars/webhook',env.TELEGRAM_STARS_PUBLIC_ORIGIN).href;
  const before=await bot('getWebhookInfo');
  if(before.url&&before.url!==expected)throw Error('Another webhook is configured; preserve it');
  await bot('setWebhook',{url:expected,secret_token:env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates:['message','pre_checkout_query'],drop_pending_updates:false});
  const after=await bot('getWebhookInfo');
  if(after.url!==expected)throw Error('Webhook destination differs');
  console.log(JSON.stringify({bot:identity.username,webhookConfigured:true,pendingUpdates:after.pending_update_count}));
}else if(operation==='baseline'){
  const snapshot=await api('snapshot');
  if(snapshot.state!=='enabled'||snapshot.withdrawalsEnabled||snapshot.gamesEnabled||snapshot.cryptoDepositsEnabled)
    throw Error('Owner probe wallet capabilities differ');
  console.log(JSON.stringify({accountHash,balanceUnits:snapshot.balanceUnits,reservedUnits:snapshot.reservedUnits}));
}else if(operation==='create'){
  const order=await api('stars',{id:saved.id,stars:100,termsAccepted:true});
  if(order.id!==saved.id||order.stars!==100||order.amountUnits!=='1000000')throw Error('Invoice parameters differ');
  console.log(JSON.stringify({id:order.id,stars:order.stars,amountUnits:order.amountUnits,botUrl:order.botUrl,status:order.status,expiresAt:order.expiresAt}));
}else if(operation==='verify'){
  const orders=await api('stars'), snapshot=await api('snapshot');
  const order=orders.operations.find(row=>row.id===saved.id);
  if(!order)throw Error('Saved invoice not found');
  const credited=BigInt(snapshot.balanceUnits)-BigInt(saved.balanceUnits);
  console.log(JSON.stringify({status:order.status,creditDeltaUnits:String(credited),amountUnits:order.amountUnits,
    expectedCreditVerified:order.status==='paid'&&credited===1000000n,
    withdrawalsEnabled:snapshot.withdrawalsEnabled,gamesEnabled:snapshot.gamesEnabled}));
}
"""


def run(operation, saved):
    source = NODE.replace('OPERATION', json.dumps(operation)).replace('SAVED', json.dumps(saved))
    result = subprocess.run(['docker', 'exec', '-i', 'royal-payments-1', 'node', '--input-type=module', '-'],
        input=source, text=True, capture_output=True, timeout=45)
    if result.returncode:
        raise RuntimeError('Owner probe operation failed; inspect the sanitized service state')
    return json.loads(result.stdout)


def write(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())


if __name__ == '__main__':
    if Path(__file__).resolve() != ROOT/'probe.py' or sys.argv[1:] not in [['setup'], ['create'], ['verify']]:
        raise RuntimeError('Unexpected owner probe operation')
    operation = sys.argv[1]
    state = ROOT/'owner-probe.json'
    if operation == 'setup':
        print(json.dumps(run('setup', {})))
    else:
        if operation == 'create' and not state.exists():
            baseline = run('baseline', {})
            write(state, {**baseline, 'id': str(uuid.uuid4())})
        if not state.is_file() or state.is_symlink():
            raise RuntimeError('Saved owner probe is required')
        print(json.dumps(run(operation, json.loads(state.read_text()))))
