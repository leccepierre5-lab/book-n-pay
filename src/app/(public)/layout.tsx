import Navbar from '@/components/layout/Navbar';
import GroupPendingBanner from '@/components/group/GroupPendingBanner';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <GroupPendingBanner />
      {children}
    </>
  );
}
