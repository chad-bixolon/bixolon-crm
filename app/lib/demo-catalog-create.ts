import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { can, type Actor } from './authorization';
import { DuplicateSkuError, parseSkuMetadataForm, saveSkuMetadata } from './odm-skus';
import { normalizePartNumber } from './product-import';
import { parseProduct, saveProduct } from './products';

const modelKey=(value:string)=>value.normalize('NFKC').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
type ProductChoice={id:number;name:string;sku:string;skus:{partNumber:string}[]};

export function demoProductCandidates(sourceSku:string,modelName:string,products:ProductChoice[],proposedSku=sourceSku){
  const source=modelKey(sourceSku),proposed=modelKey(proposedSku),model=modelKey(modelName);
  const families=[sourceSku,proposedSku].map(value=>modelKey(value.split(/[-/ ]/)[0])).filter(value=>value.length>=3);
  return products.filter(product=>{
    const names=[product.name,product.sku,...product.skus.map(sku=>sku.partNumber)].map(modelKey);
    return names.some(name=>name===model||name===source||name===proposed||families.some(family=>name===family||name.startsWith(family)));
  }).map(product=>({id:product.id,name:product.name,sku:product.sku})).slice(0,20);
}

export async function inspectDemoCatalog(db:PrismaClient,sourceSku:string,modelName='',proposedSku=sourceSku){
  const [products,categories]=await Promise.all([
    db.product.findMany({where:{active:true,archivedAt:null},select:{id:true,name:true,sku:true,skus:{select:{partNumber:true}}},orderBy:{name:'asc'}}),
    db.productCategory.findMany({where:{active:true},select:{id:true,name:true},orderBy:{name:'asc'}}),
  ]);
  const candidates=demoProductCandidates(sourceSku,modelName,products,proposedSku);
  const reviewToken=createHash('sha256').update(JSON.stringify({sourceSku,modelName,proposedSku,candidates})).digest('hex');
  return {products:products.map(({id,name,sku})=>({id,name,sku})),categories,candidates,reviewToken};
}

export async function createDemoCatalogSku(db:PrismaClient,actor:Actor,sourceSku:string,form:FormData,reviewToken:string,acknowledgeCandidates:boolean){
  if(actor.role!=='ADMIN'||!can(actor,'products.write'))throw new Error('Administrator access required.');
  if(!sourceSku.trim())throw new Error('Source SKU is missing.');
  const mode=String(form.get('mode')??'');
  if(mode!=='existing'&&mode!=='new')throw new Error('Choose an existing or new Product.');
  const partNumber=String(form.get('partNumber')??'').trim();
  if(!partNumber||partNumber.length>100)throw new Error('Part number is required and must be at most 100 characters.');
  const classification=String(form.get('catalogSourceChoice')??'');
  if(!['UNCLASSIFIED','PRICE_LIST','PE_LIST','ODM'].includes(classification))throw new Error('Choose a Catalog Source, including Unclassified if appropriate.');
  const metadataForm=new FormData();
  for(const [key,value] of form.entries())metadataForm.append(key,value);
  metadataForm.set('catalogSource',classification==='UNCLASSIFIED'?'':classification);
  metadataForm.set('partNumber',partNumber);
  metadataForm.set('active','true');
  const metadata=parseSkuMetadataForm(metadataForm);
  const duplicate=await db.productSku.findUnique({where:{normalizedPartNumber:normalizePartNumber(partNumber)},include:{product:{select:{name:true}}}});
  if(duplicate)throw new DuplicateSkuError({id:duplicate.id,partNumber:duplicate.partNumber,productId:duplicate.productId,productName:duplicate.product.name,catalogSource:duplicate.catalogSource});
  if(mode==='existing'){
    const productId=Number(form.get('productId'));
    if(!Number.isSafeInteger(productId)||productId<=0)throw new Error('Select an existing Product.');
    const product=await db.product.findUnique({where:{id:productId}});
    if(!product||!product.active||product.archivedAt)throw new Error('Product is unavailable.');
    const sku=await saveSkuMetadata(db,{...metadata,productId});
    return {skuId:sku.id,productId};
  }
  const name=String(form.get('name')??'').trim();
  const review=await inspectDemoCatalog(db,sourceSku,name,partNumber);
  if(!reviewToken||reviewToken!==review.reviewToken)throw new Error('Product candidates changed. Review creation again.');
  if(review.candidates.some(candidate=>modelKey(candidate.name)===modelKey(name)))throw new Error('A Product with this model already exists. Add the SKU beneath it.');
  if(review.candidates.length&&!acknowledgeCandidates)throw new Error('Review likely Product matches before creating a new Product.');
  metadataForm.set('sku',partNumber);
  const parsed=parseProduct(metadataForm);
  if(!parsed.value)throw new Error(Object.values(parsed.errors).join(' ')||'Product details are invalid.');
  const productId=await saveProduct(db,parsed.value,undefined,metadata);
  const sku=await db.productSku.findUnique({where:{normalizedPartNumber:normalizePartNumber(partNumber)},select:{id:true,productId:true}});
  if(!sku||sku.productId!==productId)throw new Error('Created SKU was not found.');
  return {skuId:sku.id,productId};
}
