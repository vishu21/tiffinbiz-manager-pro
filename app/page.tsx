import { redirect } from 'next/navigation';

// The site root lands on the Kitchen Prep and Packaging dashboard.
export default function Home() {
  redirect('/prep');
}
