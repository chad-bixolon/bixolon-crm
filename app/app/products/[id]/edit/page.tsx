import { requirePermission } from '@/lib/current-user';
import { ProductDetails } from '../product-details';

export const dynamic = 'force-dynamic';

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('products.write');
  return <ProductDetails id={Number((await params).id)} manage />;
}
