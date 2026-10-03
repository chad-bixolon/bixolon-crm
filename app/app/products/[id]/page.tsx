import { requirePermission } from '@/lib/current-user';
import { ProductDetails } from './product-details';

export const dynamic = 'force-dynamic';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('products.read');
  return <ProductDetails id={Number((await params).id)} manage={false} />;
}
