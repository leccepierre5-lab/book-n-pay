import Navbar from '@/components/layout/Navbar';
import GroupPendingBanner from '@/components/group/GroupPendingBanner';
import OverageBanner from './pro/_components/OverageBanner';

export default function ProLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <GroupPendingBanner />
      <OverageBanner />
      {children}
    </>
  );
}
