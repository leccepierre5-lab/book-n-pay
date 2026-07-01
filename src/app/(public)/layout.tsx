import Navbar from '@/components/layout/Navbar';
import GroupPendingBanner from '@/components/group/GroupPendingBanner';
import PostVisitPopup from '@/components/booking/PostVisitPopup';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <GroupPendingBanner />
      <PostVisitPopup />
      {children}
    </>
  );
}
