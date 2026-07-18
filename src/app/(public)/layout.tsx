import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import GroupPendingBanner from '@/components/group/GroupPendingBanner';
import PostVisitPopup from '@/components/booking/PostVisitPopup';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Navbar />
      <GroupPendingBanner />
      <PostVisitPopup />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
