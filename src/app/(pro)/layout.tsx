import Navbar from '@/components/layout/Navbar';

export default function ProLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      {children}
    </>
  );
}
