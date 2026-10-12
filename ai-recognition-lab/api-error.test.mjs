import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apiError} from './api-error.mjs';
test('區分額度不足並隱藏金鑰',async()=>{const e=await apiError(new Response(JSON.stringify({error:{code:'insufficient_quota',message:'quota sk-secret'}}),{status:429}),'sk-secret');assert.ok(e.message.includes('帳務'));assert.ok(!e.message.includes('sk-secret'));assert.equal(e.stopPipeline,true);});
test('頻率限制顯示重試時間',async()=>{const e=await apiError(new Response(JSON.stringify({error:{code:'rate_limit_exceeded',message:'tokens limit'}}),{status:429,headers:{'retry-after':'10'}}));assert.ok(e.message.includes('Retry-After：10'));assert.ok(e.message.includes('Token'));});
