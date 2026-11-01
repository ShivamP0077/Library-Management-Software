import Nav from './components/Nav.jsx';
import Hero from './components/Hero.jsx';
import Problem from './components/Problem.jsx';
import Features from './components/Features.jsx';
import Showcase from './components/Showcase.jsx';
import HowItWorks from './components/HowItWorks.jsx';
import Branches from './components/Branches.jsx';
import Pricing from './components/Pricing.jsx';
import FAQ from './components/FAQ.jsx';
import Footer, { FinalCTA } from './components/Footer.jsx';

export default function App() {
  return (
    <>
      <a href="#main" className="sr-only z-[60] rounded-lg bg-gold-400 px-4 py-2 font-semibold text-ink-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Problem />
        <Features />
        <Showcase />
        <HowItWorks />
        <Branches />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
