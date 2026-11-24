#!/usr/bin/env node
// Fail CI if an unescaped quote or another syntax error prevents the
// live Opening Lab page from initializing its board and controls.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {Script} from 'node:vm';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const html=readFileSync(resolve(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
 .filter(m=>m[1].trim().length>0);
if(!scripts.length)throw Error('No inline application JavaScript found');
for(const [index,m] of scripts.entries()){
 new Script(m[1],{filename:'index.html:inline-script-'+(index+1)});
}
if(!html.includes('initCustomDropdowns();render();'))
 throw Error('Application startup render call missing');
console.log('Browser startup syntax: '+scripts.length+'/'+scripts.length+' inline scripts parse.');
