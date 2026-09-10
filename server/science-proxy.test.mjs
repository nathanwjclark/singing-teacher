import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createScienceProxy} from './science-proxy.mjs';

function fakeRequest({method='GET',url='/api/science/health',headers={},remote='127.0.0.1',body=''}={}) {
  const req=Readable.from(body?[Buffer.from(body)]:[]);
  Object.assign(req,{method,url,headers:{host:'localhost:5173',...headers},socket:{remoteAddress:remote}});
  const res=new EventEmitter();
  Object.assign(res,{writeHead(status){this.status=status},end(body){this.body=JSON.parse(body);this.writableEnded=true}});
  return [req,res];
}
test('unconfigured and unsafe destinations fail before access',()=>{
  assert.equal(createScienceProxy(),null);
  for(const url of ['https://127.0.0.1','http://example.com','http://127.0.0.1/other','http://x:y@127.0.0.1'])
    assert.throws(()=>createScienceProxy({url,token:'x'.repeat(32)}));
});
test('every route is desktop-only and cross-origin/path input cannot reach upstream',async()=>{
  let calls=0;
  const proxy=createScienceProxy({url:'http://127.0.0.1:9999',token:'x'.repeat(32),fetchImpl:async()=>{calls++;throw Error('not expected')}});
  for(const input of [{remote:'192.168.1.2'},{headers:{origin:'https://localhost:5173'}},
    {headers:{origin:'http://evil.invalid'}},{headers:{'sec-fetch-site':'cross-site'}},
    {headers:{host:'evil.invalid'}},{url:'/api/science/jobs/../models'},
    {url:'/api/science/health?token=anything'},{method:'DELETE'}]){
    const [req,res]=fakeRequest(input);await proxy(req,res);assert.ok([403,404,405].includes(res.status));
  }
  assert.equal(calls,0);
});
test('real upstream sees private token and constrained JSON only',async()=>{
  let seen;
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    seen={url:req.url,authorization:req.headers.authorization,body:JSON.parse(Buffer.concat(chunks).toString())};
    res.writeHead(201,{'Content-Type':'application/json','X-Private':'must-not-forward'});res.end(JSON.stringify({job_id:'job-1'}));
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  try{
    const proxy=createScienceProxy({url:`http://127.0.0.1:${upstream.address().port}`,token:'private-test-token'.repeat(3)});
    const [req,res]=fakeRequest({method:'POST',url:'/api/science/jobs',headers:{'content-type':'application/json',origin:'http://localhost:5173'},body:'{"request":{"operation":"forward"}}'});
    await proxy(req,res);assert.equal(res.status,201);assert.deepEqual(res.body,{job_id:'job-1'});
    assert.equal(seen.url,'/jobs');assert.equal(seen.authorization,'Bearer '+'private-test-token'.repeat(3));
    assert.deepEqual(seen.body,{request:{operation:'forward'}});
  }finally{await new Promise(resolve=>upstream.close(resolve))}
});
test('request and response limits, redirects and timeouts remain errors',async()=>{
  const options={url:'http://127.0.0.1:9999',token:'x'.repeat(32)};
  const [large,res]=fakeRequest({method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(2_000_001)});
  await createScienceProxy({...options,fetchImpl:async()=>{throw Error('not reached')}})(large,res);
  assert.equal(res.status,413);
  const [req,out]=fakeRequest();
  await createScienceProxy({...options,fetchImpl:async()=>new Response('x'.repeat(16_000_001))})(req,out);
  assert.equal(out.status,504);
  const [slow,result]=fakeRequest();
  await createScienceProxy({...options,timeoutMs:100,fetchImpl:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))})(slow,result);
  assert.equal(result.status,504);assert.ok(!JSON.stringify(result.body).includes(options.token));
});
