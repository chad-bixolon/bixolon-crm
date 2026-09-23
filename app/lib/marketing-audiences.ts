import { AccountBusinessRoleCode, MarketingPreference, Prisma, type MarketingAudience, type PrismaClient, TradeShowLeadRouting, TradeShowLeadStatus } from "@prisma/client";
import { can, type Actor } from "./authorization";

export const audienceVisibilities = ["PERSONAL","SHARED"] as const;
export type AudienceVisibility = typeof audienceVisibilities[number];
export type MarketingAudienceConfig = {
  search?:string; title?:string; preference?:MarketingPreference; emailPresence?:"PRESENT"|"MISSING";
  accountId?:number; industry?:string; businessRole?:AccountBusinessRoleCode; territory?:string; accountOwnerId?:number; activeAccount?:boolean;
  tradeShowId?:number; showDateFrom?:string; showDateTo?:string; leadStatus?:TradeShowLeadStatus; routing?:TradeShowLeadRouting;
  assignedSalesRepId?:number; referralPartnerId?:number; converted?:boolean; productInterest?:string; competitorId?:number;
};
export const defaultAudienceConfig:MarketingAudienceConfig={preference:"OPTED_IN"};
const keys=new Set<keyof MarketingAudienceConfig>(["search","title","preference","emailPresence","accountId","industry","businessRole","territory","accountOwnerId","activeAccount","tradeShowId","showDateFrom","showDateTo","leadStatus","routing","assignedSalesRepId","referralPartnerId","converted","productInterest","competitorId"]);
const idKeys=new Set(["accountId","accountOwnerId","tradeShowId","assignedSalesRepId","referralPartnerId","competitorId"]);
const textKeys=new Set(["search","title","industry","territory","productInterest"]);
const datePattern=/^\d{4}-\d{2}-\d{2}$/;

export function validateAudienceConfig(raw:unknown):MarketingAudienceConfig {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Audience filters are invalid.");
  const source=raw as Record<string,unknown>, result:Record<string,unknown>={};
  for(const [key,value] of Object.entries(source)){
    if(!keys.has(key as keyof MarketingAudienceConfig))throw new Error(`Audience filter “${key}” is no longer supported.`);
    if(value===undefined||value===null||value==="")continue;
    if(idKeys.has(key)){if(!Number.isSafeInteger(value)||Number(value)<=0)throw new Error(`Audience filter “${key}” is invalid.`);result[key]=value;continue;}
    if(textKeys.has(key)){if(typeof value!=="string"||value.trim().length>200)throw new Error(`Audience filter “${key}” is invalid.`);result[key]=value.trim();continue;}
    if(key==="showDateFrom"||key==="showDateTo"){if(typeof value!=="string"||!datePattern.test(value))throw new Error(`Audience filter “${key}” is invalid.`);result[key]=value;continue;}
    if(key==="preference"&&!Object.values(MarketingPreference).includes(value as MarketingPreference))throw new Error("Marketing Preference filter is invalid.");
    if(key==="emailPresence"&&!(["PRESENT","MISSING"] as unknown[]).includes(value))throw new Error("Email presence filter is invalid.");
    if(key==="businessRole"&&!Object.values(AccountBusinessRoleCode).includes(value as AccountBusinessRoleCode))throw new Error("Business Role filter is invalid.");
    if(key==="leadStatus"&&!Object.values(TradeShowLeadStatus).includes(value as TradeShowLeadStatus))throw new Error("Lead Status filter is invalid.");
    if(key==="routing"&&!Object.values(TradeShowLeadRouting).includes(value as TradeShowLeadRouting))throw new Error("Lead Routing filter is invalid.");
    if((key==="activeAccount"||key==="converted")&&typeof value!=="boolean")throw new Error(`Audience filter “${key}” is invalid.`);
    result[key]=value;
  }
  return result as MarketingAudienceConfig;
}

export function audienceContactWhere(raw:unknown):Prisma.ContactWhereInput {
  const config=validateAudienceConfig(raw), clauses:Prisma.ContactWhereInput[]=[{active:true,archivedAt:null}];
  if(config.search)clauses.push({OR:[{firstName:{contains:config.search,mode:"insensitive"}},{lastName:{contains:config.search,mode:"insensitive"}},{email:{contains:config.search,mode:"insensitive"}}]});
  if(config.title)clauses.push({title:{contains:config.title,mode:"insensitive"}});
  if(config.preference)clauses.push({marketingPreference:config.preference});
  if(config.emailPresence==="PRESENT")clauses.push({email:{not:null},NOT:{email:""}});
  if(config.emailPresence==="MISSING")clauses.push({OR:[{email:null},{email:""}]});
  const account:Prisma.AccountWhereInput={};
  if(config.accountId)account.id=config.accountId;
  if(config.industry)account.industry=config.industry;
  if(config.businessRole)account.businessRoles={some:{role:config.businessRole}};
  if(config.territory)account.territory=config.territory;
  if(config.accountOwnerId)account.ownerId=config.accountOwnerId;
  if(config.activeAccount===true){account.status="ACTIVE";account.archivedAt=null;}
  if(config.activeAccount===false)account.OR=[{status:{not:"ACTIVE"}},{archivedAt:{not:null}}];
  if(Object.keys(account).length)clauses.push({account:{is:account}});
  const lead:Prisma.TradeShowLeadWhereInput={};
  if(config.tradeShowId)lead.tradeShowId=config.tradeShowId;
  if(config.showDateFrom||config.showDateTo)lead.tradeShow={is:{startDate:{...(config.showDateFrom?{gte:new Date(`${config.showDateFrom}T00:00:00Z`)}:{}),...(config.showDateTo?{lt:new Date(new Date(`${config.showDateTo}T00:00:00Z`).getTime()+86400000)}:{})}}};
  if(config.leadStatus)lead.status=config.leadStatus;
  if(config.routing)lead.routing=config.routing;
  if(config.assignedSalesRepId)lead.assignedSalesRepUserId=config.assignedSalesRepId;
  if(config.referralPartnerId)lead.routedPartnerAccountId=config.referralPartnerId;
  if(config.converted!==undefined)lead.convertedOpportunityId=config.converted?{not:null}:null;
  if(config.productInterest)lead.productInterest={contains:config.productInterest,mode:"insensitive"};
  if(config.competitorId)lead.competitorId=config.competitorId;
  if(Object.keys(lead).length)clauses.push({tradeShowLeads:{some:lead}});
  return {AND:clauses};
}

export function canViewAudience(actor:Actor,audience:Pick<MarketingAudience,"ownerId"|"visibility">){return can(actor,"marketing.read")&&(actor.role==="ADMIN"||audience.ownerId===actor.id||audience.visibility==="SHARED");}
export function canManageAudience(actor:Actor,audience?:Pick<MarketingAudience,"ownerId">){return can(actor,"marketing.write")&&(!audience||actor.role==="ADMIN"||audience.ownerId===actor.id);}
export function canExportAudience(actor:Actor,audience:Pick<MarketingAudience,"ownerId"|"visibility">){return can(actor,"marketing.write")&&canViewAudience(actor,audience);}
export function audienceListWhere(actor:Actor,includeArchived=false):Prisma.MarketingAudienceWhereInput{return {...(!includeArchived?{archivedAt:null}:{}),...(actor.role==="ADMIN"?{}:{OR:[{ownerId:actor.id},{visibility:"SHARED"}]})};}
export function validEmail(email:string|null){return !!email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);}

export async function resolveAudienceContactIds(client:PrismaClient,audience:{id:number;filterConfig:Prisma.JsonValue}){
  const matched=(await client.contact.findMany({where:audienceContactWhere(audience.filterConfig),select:{id:true}})).map(x=>x.id);
  const overrides=await client.marketingAudienceContactOverride.findMany({where:{audienceId:audience.id},select:{contactId:true,kind:true}});
  const excluded=new Set(overrides.filter(x=>x.kind==="EXCLUDE").map(x=>x.contactId));
  const included=overrides.filter(x=>x.kind==="INCLUDE").map(x=>x.contactId);
  const eligibleIncludes=(await client.contact.findMany({where:{id:{in:included},active:true,archivedAt:null},select:{id:true}})).map(x=>x.id);
  const selected=[...new Set([...matched.filter(id=>!excluded.has(id)),...eligibleIncludes])];
  return {matched,selected,overrides};
}

export const audienceContactInclude={account:{include:{businessRoles:true,industryCategory:true,territoryCategory:true,owner:true}},tradeShowLeads:{include:{tradeShow:true},orderBy:{capturedAt:"desc" as const},take:1}} as const;
export async function audienceSummary(client:PrismaClient,ids:number[],matchedCount:number){
  if(!ids.length)return {matched:matchedCount,selected:0,optedIn:0,unknown:0,optedOut:0,missingEmail:0,marketingReady:0};
  const rows=await client.contact.findMany({where:{id:{in:ids}},select:{marketingPreference:true,email:true}});
  return {matched:matchedCount,selected:rows.length,optedIn:rows.filter(x=>x.marketingPreference==="OPTED_IN").length,unknown:rows.filter(x=>x.marketingPreference==="UNKNOWN").length,optedOut:rows.filter(x=>x.marketingPreference==="OPTED_OUT").length,missingEmail:rows.filter(x=>!validEmail(x.email)).length,marketingReady:rows.filter(x=>x.marketingPreference==="OPTED_IN"&&validEmail(x.email)).length};
}

export function parseAudienceForm(form:FormData){
  const number=(name:string)=>{const value=Number(form.get(name));return Number.isSafeInteger(value)&&value>0?value:undefined;};
  const text=(name:string)=>String(form.get(name)??"").trim()||undefined;
  const bool=(name:string)=>form.get(name)==="true"?true:form.get(name)==="false"?false:undefined;
  return validateAudienceConfig({search:text("search"),title:text("title"),preference:text("preference"),emailPresence:text("emailPresence"),accountId:number("accountId"),industry:text("industry"),businessRole:text("businessRole"),territory:text("territory"),accountOwnerId:number("accountOwnerId"),activeAccount:bool("activeAccount"),tradeShowId:number("tradeShowId"),showDateFrom:text("showDateFrom"),showDateTo:text("showDateTo"),leadStatus:text("leadStatus"),routing:text("routing"),assignedSalesRepId:number("assignedSalesRepId"),referralPartnerId:number("referralPartnerId"),converted:bool("converted"),productInterest:text("productInterest"),competitorId:number("competitorId")});
}

export function csvCell(value:unknown){const text=String(value??"");return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;}
export function contactsCsv(rows:Prisma.ContactGetPayload<{include:typeof audienceContactInclude}>[]){
  const header=["Contact ID","First Name","Last Name","Email","Phone","Title","Account ID","Account Name","Account Business Roles","Industry","Territory","Account Owner","Marketing Preference"];
  const lines=rows.map(c=>[c.id,c.firstName,c.lastName,c.email,c.phone,c.title,c.accountId,c.account?.name,c.account?.businessRoles.map(r=>r.role).join("; "),c.account?.industryCategory?.name??c.account?.industry,c.account?.territoryCategory?.name??c.account?.territory,c.account?.owner?`${c.account.owner.firstName} ${c.account.owner.lastName}`:"",c.marketingPreference]);
  return [header,...lines].map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n";
}

export async function audienceBuilderOptions(client:PrismaClient){
  const [accounts,industries,territories,users,partners,tradeShows,competitors]=await Promise.all([
    client.account.findMany({where:{archivedAt:null},orderBy:{name:"asc"},select:{id:true,name:true}}),
    client.industry.findMany({where:{active:true},orderBy:[{sortOrder:"asc"},{name:"asc"}],select:{code:true,name:true}}),
    client.territory.findMany({where:{active:true},orderBy:[{sortOrder:"asc"},{name:"asc"}],select:{code:true,name:true}}),
    client.user.findMany({where:{active:true,archivedAt:null},orderBy:[{lastName:"asc"},{firstName:"asc"}],select:{id:true,firstName:true,lastName:true}}),
    client.account.findMany({where:{archivedAt:null,businessRoles:{some:{role:{in:["DISTRIBUTOR","VAR","ISV","OEM","PARTNER"]}}}},orderBy:{name:"asc"},select:{id:true,name:true}}),
    client.tradeShow.findMany({where:{archivedAt:null},orderBy:[{startDate:"desc"},{name:"asc"}],select:{id:true,name:true,startDate:true}}),
    client.competitorOption.findMany({where:{active:true},orderBy:[{sortOrder:"asc"},{name:"asc"}],select:{id:true,name:true}}),
  ]);
  return {accounts:accounts.map(x=>({value:x.id,label:x.name})),industries:industries.map(x=>({value:x.code,label:x.name})),territories:territories.map(x=>({value:x.code,label:x.name})),users:users.map(x=>({value:x.id,label:`${x.firstName} ${x.lastName}`})),partners:partners.map(x=>({value:x.id,label:x.name})),tradeShows:tradeShows.map(x=>({value:x.id,label:`${x.name}${x.startDate?` (${x.startDate.toISOString().slice(0,4)})`:""}`})),competitors:competitors.map(x=>({value:x.id,label:x.name}))};
}
