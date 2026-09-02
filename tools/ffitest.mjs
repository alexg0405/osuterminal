import koffi from 'koffi';
const user32 = koffi.load('user32.dll');
const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
const GetCursorPos     = user32.func('bool __stdcall GetCursorPos(_Out_ POINT *p)');
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int i)');

const ms = () => Number(process.hrtime.bigint())/1e6;
const pt = {};
console.log('screen         :', GetSystemMetrics(0)+'x'+GetSystemMetrics(1), 'px');
GetCursorPos(pt);
console.log('cursor now     :', pt.x+','+pt.y, '(pixel-precise, terminal not involved)');

const N=20000;
let t0=ms(); for(let i=0;i<N;i++) GetCursorPos(pt); const per=(ms()-t0)/N;
console.log('GetCursorPos   :', per.toFixed(4), 'ms/call ->', Math.round(1/per).toLocaleString(), 'Hz max');

t0=ms(); for(let i=0;i<N;i++) GetAsyncKeyState(0x5A); const per2=(ms()-t0)/N;
console.log('GetAsyncKeyState:', per2.toFixed(4), 'ms/call ->', Math.round(1/per2).toLocaleString(), 'Hz max');

console.log('');
const costPerPoll = per + per2*4;           // cursor + Z,X,LMB,RMB
console.log('one full input poll (cursor + 4 keys):', costPerPoll.toFixed(4), 'ms');
console.log('at 1000 Hz that is', (costPerPoll*100).toFixed(2)+'% of one core');
