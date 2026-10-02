const quarters=['Q1','Q2','Q3','Q4'] as const;
export function splitEvenly(value:string,places:number):string[]{
  if(!/^\d+(?:\.\d+)?$/.test(value)) return quarters.map(()=>'');
  const [whole,fraction='']=value.split('.');
  if(fraction.length>places)return quarters.map(()=>'');
  const scale=BigInt(10)**BigInt(places),amount=BigInt(whole)*scale+BigInt(fraction.padEnd(places,'0'));
  const base=amount/BigInt(4),remainder=amount%BigInt(4);
  return quarters.map((_,i)=>{const part=base+(BigInt(i)<remainder?BigInt(1):BigInt(0));return places?`${part/scale}.${String(part%scale).padStart(places,'0')}`:part.toString();});
}
