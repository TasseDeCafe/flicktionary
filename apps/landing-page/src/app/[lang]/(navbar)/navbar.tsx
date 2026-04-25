import { LangProps } from '@/types/lang-props'
import DesktopNavbar from '@/app/[lang]/(navbar)/desktop-navbar'
import MobileNavbar from '@/app/[lang]/(navbar)/mobile-navbar'

const Navbar = ({ lang }: LangProps) => {
  return (
    <nav className='relative z-40 flex w-full items-center justify-between bg-gray-50 px-4 py-4 md:px-8'>
      <DesktopNavbar lang={lang} />
      <MobileNavbar lang={lang} />
    </nav>
  )
}

export default Navbar
