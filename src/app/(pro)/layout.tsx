import Navbar from '@/components/layout/Navbar';
import GroupPendingBanner from '@/components/group/GroupPendingBanner';

export default function ProLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <GroupPendingBanner />
      {children}
    </>
  );
}
