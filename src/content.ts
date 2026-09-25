// All copy is pulled verbatim from the 2026 site build (site-v2/src/data/*),
// so every concept stays in sync with the real voice of Hark Digital.

/**
 * This concept. scripts/new-site.sh rewrites these two values.
 *   name: shown in the chrome's "Concept · <name>" tag and the page title
 *   slug: the GitHub repo / Pages path (https://harkdigital.github.io/<slug>/)
 */
export const SITE = {
  name: 'Silicon',
  slug: 'hark-silicon',
}

/**
 * Every Hark concept site, for "see the other concepts" links. Add each new
 * concept here once it ships (the current one is filtered out by slug).
 */
export const CONCEPTS = [
  { name: 'Classic 2026 site', slug: 'hark-digital-2026' },
  { name: 'Orbit', slug: 'hark-igloo' },
  { name: 'Resonance', slug: 'hark-resonance' },
  { name: 'Press', slug: 'hark-press' },
  { name: 'Town', slug: 'hark-town' },
  { name: 'Arcade', slug: 'hark-arcade' },
  { name: 'Glass', slug: 'hark-glass' },
  { name: 'Tower', slug: 'hark-tower' },
  { name: 'Plexus', slug: 'hark-plexus' },
  { name: 'Frost', slug: 'hark-frost' },
].map(c => ({ ...c, url: `https://harkdigital.github.io/${c.slug}/` }))

/** The other concepts (everything except this one). */
export const OTHER_CONCEPTS = CONCEPTS.filter(c => c.slug !== SITE.slug)

export const BRAND = {
  name: 'Hark Digital Design',
  short: 'Hark.Digital',
  email: 'mike@hark.digital',
  tagline: 'Make the internet listen.',
  locale: 'Philadelphia · Everywhere · est. 2016',
  manifesto:
    'Software, web design, ecommerce, SEO/GEO, security, and aerial media. From publicly traded companies to mom-and-pop pizza shops.',
  classicSite: 'https://harkdigital.github.io/hark-digital-2026/',
}

export interface Service {
  num: string
  slug: string
  title: string
  blurb: string
  tags: string[]
}

export const SERVICES: Service[] = [
  {
    num: '01',
    slug: 'software-development',
    title: 'Software Development',
    blurb:
      'Custom CRMs, client portals, and dashboards built around how your business actually runs. Every lead, job, and customer in one system that fits like it was made for you, because it was.',
    tags: ['Custom CRMs', 'Client Portals', 'Dashboards', 'Integrations'],
  },
  {
    num: '02',
    slug: 'web-design',
    title: 'Web Design',
    blurb:
      'Beautiful, functional websites that promote your business and are easy to update. Modern frameworks, responsive on every device, built to convert visitors into customers.',
    tags: ['UI/UX', 'Responsive', 'CMS', 'Branding'],
  },
  {
    num: '03',
    slug: 'ecommerce',
    title: 'Ecommerce',
    blurb:
      'From thousands of products to a single payment portal, secure, flexible online stores with the analytics to track sales, spot trends, and grow.',
    tags: ['Online Stores', 'Payment Portals', 'Analytics', 'Conversion'],
  },
  {
    num: '04',
    slug: 'seo-geo',
    title: 'SEO / GEO',
    blurb:
      'Search engine optimization for how people find you today, and generative engine optimization for how AI answers about you tomorrow. Stay visible in both worlds.',
    tags: ['Search Ranking', 'AI Discoverability', 'Local SEO', 'Content Strategy'],
  },
  {
    num: '05',
    slug: 'page-speed',
    title: 'Page Speed',
    blurb:
      'Slow site dragging down your Google score and your sales? We fix Core Web Vitals, turn those red PageSpeed and GTmetrix numbers green, and make pages load in a blink.',
    tags: ['Core Web Vitals', 'PageSpeed Insights', 'GTmetrix', 'Load Time'],
  },
  {
    num: '06',
    slug: 'ai-consulting',
    title: 'AI Consulting',
    blurb:
      'Cut through the hype. We find where AI genuinely saves your business time and money, build it into your workflow, and skip the snake oil.',
    tags: ['Opportunity Audit', 'Custom AI Tools', 'Automation', 'Team Training'],
  },
  {
    num: '07',
    slug: 'aerial-media',
    title: 'Aerial Photography & Video',
    blurb:
      'Professional, insured drone piloting for cinematic productions, real estate, construction progress, inspections, and imagery that makes your site impossible to scroll past.',
    tags: ['Drone Video', 'Real Estate', 'Inspections', 'Cinematic'],
  },
  {
    num: '08',
    slug: 'hack-remediation',
    title: 'Hack Remediation',
    blurb:
      'Site compromised? We find the breach, clean the infection, restore your site, and close the door behind us, then harden everything so it stays closed.',
    tags: ['Malware Removal', 'Breach Response', 'Recovery', 'Blocklist Removal'],
  },
  {
    num: '09',
    slug: 'security',
    title: 'Website & Data Security',
    blurb:
      'Proactive protection for your website and the data behind it, hardening, monitoring, backups, and updates handled before problems become headlines.',
    tags: ['Hardening', 'Monitoring', 'Backups', 'SSL & Compliance'],
  },
  {
    num: '10',
    slug: 'ada-accessibility',
    title: 'ADA Accessibility',
    blurb:
      'One in four American adults lives with a disability. We audit and fix your site to WCAG standards, so every visitor can use it and ADA demand letters have nothing to find.',
    tags: ['WCAG Audits', 'Remediation', 'Screen Reader Testing', 'ADA Compliance'],
  },
  {
    num: '11',
    slug: 'wordpress',
    title: 'WordPress',
    blurb:
      'Powering over forty percent of the web, and most of its headaches. We build, rescue, speed up, and secure WordPress sites, and we’ve seen every way they break.',
    tags: ['Custom Builds', 'Plugin Rescue', 'Speed & Security', 'Care Plans'],
  },
]

export interface WorkItem {
  id: string
  name: string
  url: string
  industry: string
  blurb: string
  tags: string[]
  featured: boolean
}

/** Screenshot for a work item: public/work/<id>.webp (1280×800). */
export const workImage = (id: string) => `${import.meta.env.BASE_URL}work/${id}.webp`

export const WORK: WorkItem[] = [
  {
    id: 'clc',
    name: 'City Line Capital',
    url: 'https://clc.harktest.com/',
    industry: 'Real Estate Investment',
    blurb: 'National real estate platform, 345+ properties across 32 states, $2B+ deployed.',
    tags: ['Web Design', 'SEO'],
    featured: true,
  },
  {
    id: 'comtec',
    name: 'ComTec Systems',
    url: 'https://comtecsystems.net/',
    industry: 'Telecom / UCaaS',
    blurb: 'Cloud voice and unified communications, with customer and partner portals.',
    tags: ['Web Design', 'Software', 'SEO'],
    featured: true,
  },
  {
    id: 'atlas',
    name: 'Atlas Real Estate',
    url: 'https://soldbyatlas.com/',
    industry: 'Real Estate',
    blurb: 'Full IDX-powered listing search for a brokerage that rethinks real estate.',
    tags: ['Web Design', 'IDX Search'],
    featured: true,
  },
  {
    id: 'jomar',
    name: 'Jomar Corporation',
    url: 'https://jomarcorp.com/',
    industry: 'Industrial Manufacturing',
    blurb: 'Global leader in injection blow molding machines, selling worldwide.',
    tags: ['Web Design', 'SEO'],
    featured: true,
  },
  {
    id: 'tixforgood',
    name: 'Tix For Good',
    url: 'https://tixforgood.org/',
    industry: 'Nonprofit Platform',
    blurb: 'Donor appreciation network connecting brands, nonprofits, and donors.',
    tags: ['Web Design', 'Software'],
    featured: true,
  },
  {
    id: 'amplifier',
    name: 'Amplifier Fundraising',
    url: 'https://amplifierfundraising.org/',
    industry: 'Nonprofit Fundraising',
    blurb: 'Professional fundraising that encourages good: auctions, ambassadors, and more.',
    tags: ['Web Design', 'Branding'],
    featured: true,
  },
  {
    id: 'scribewise',
    name: 'Scribewise',
    url: 'https://scribewise.com/',
    industry: 'Marketing & PR',
    blurb: 'Thought leadership marketing and GEO for professional services firms.',
    tags: ['Web Design'],
    featured: false,
  },
  {
    id: 'acctrans',
    name: 'Accelerated Transport',
    url: 'https://acctrans.net/',
    industry: 'Trucking & Logistics',
    blurb: 'Long-haul freight, fleet showcase, and CDL-A driver recruiting.',
    tags: ['Web Design', 'SEO'],
    featured: false,
  },
  {
    id: 'reliablepower',
    name: 'Reliable Power Plus',
    url: 'https://reliablepowerplus.com/',
    industry: 'Generators',
    blurb: 'Standby generator installation and service across the Philadelphia region.',
    tags: ['Web Design', 'SEO'],
    featured: false,
  },
  {
    id: 'schwing',
    name: 'SCHWING Technologies NA',
    url: 'https://schwing.tech/',
    industry: 'Industrial Manufacturing',
    blurb: 'High-temperature thermal cleaning systems for global manufacturers.',
    tags: ['Web Design', 'SEO'],
    featured: false,
  },
  {
    id: 'tricity',
    name: 'TriCity Kitchens',
    url: 'https://tricitykitchen.com/',
    industry: 'Kitchen & Bath',
    blurb: 'Cabinetry, countertops, and two showrooms serving the Mid-Atlantic.',
    tags: ['Web Design', 'SEO'],
    featured: false,
  },
  {
    id: 'cumberland',
    name: 'Cumberland Internal Medicine',
    url: 'https://cumberlandinternalmedicine.com/',
    industry: 'Healthcare',
    blurb: '30 years of primary care and infectious disease expertise in the Philadelphia region.',
    tags: ['Web Design', 'SEO'],
    featured: false,
  },
  {
    id: 'haines',
    name: 'Haines Family Dental',
    url: 'https://hainesfamilydental.com/',
    industry: 'Dentistry',
    blurb: 'Creating healthy smiles with a modern, welcoming practice site.',
    tags: ['Web Design', 'SEO'],
    featured: false,
  },
  {
    id: 'ogren',
    name: 'Ogren Construction',
    url: 'http://ogrenconstruction.com/',
    industry: 'Construction',
    blurb: 'Enthusiasm and passion down to the last detail, in commercial construction.',
    tags: ['Web Design', 'Photography'],
    featured: false,
  },
  {
    id: 'outercoastal',
    name: 'Outer Coastal Plain',
    url: 'https://outercoastalplain.com/',
    industry: 'Wine & Viticulture',
    blurb: "Trade association for one of America's most surprising wine regions.",
    tags: ['Web Design'],
    featured: false,
  },
]

export interface Testimonial {
  quote: string
  name: string
  company: string
}

// Real client reviews of Hark Digital Design.
export const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      'Mike has exceptional technical ability but at his core he is an artist. He brilliantly created a clean, concise and modern website that has significantly bolstered our business.',
    name: 'Andrew Fabbri',
    company: 'Fabbri Builders',
  },
  {
    quote:
      'His ideas were fresh and unique to our company. Mike helped launch a successful holiday season campaign that brought us record number sales.',
    name: 'Holly Kisby',
    company: "Shriver's Salt Water Taffy",
  },
  {
    quote:
      'Very excited to have worked with Mike to get our website totally fixed after a disaster experience with TWO other developers. In one month, he turned around a website that fits our needs, suits our vibe, and looks awesome.',
    name: 'Barbara Barber',
    company: 'CrossFit Off The Grid',
  },
  {
    quote:
      'They deliver a quality product with great support at a fraction of the cost of other media companies. Any time we have a question they are quick to respond.',
    name: 'Scott Quarella',
    company: 'Bellview Winery',
  },
  {
    quote:
      'He brought us out of the 90s and now we have a modern, swanky website that I could not be happier with. Glass is tricky to photograph but he knocked it out of the park.',
    name: 'Christina Rossi',
    company: 'PEG Glass',
  },
  {
    quote:
      'Mike took the time to fully understand our school’s needs and designed a site infrastructure that meets them perfectly. It has been met with rave reviews.',
    name: 'MaryJane Kinkade',
    company: 'Our Lady of Mercy Academy',
  },
  {
    quote:
      'Mike built the website on time, on budget, trained us, and followed up to make sure everything was running smooth throughout the entire project.',
    name: 'Pete Rose',
    company: 'The Home Hero',
  },
  {
    quote:
      'Mike was able to update our brand and transform our website into something we are really proud of. His creativity, responsiveness and professionalism made the whole process easy.',
    name: 'Alicyn Harkness',
    company: 'ProviderSoft',
  },
]

/** Headline stats, verbatim from the service pages (site-v2/src/data/servicePages.ts). */
export const STATS = [
  { value: '10 years', label: 'Of custom software for real businesses. Portals, dashboards, and integrations since 2016.' },
  { value: '15', label: 'Live sites in the portfolio right now, from dentists to global manufacturers' },
  { value: '$1M+', label: 'Flows through client stores we built, every single year' },
  { value: '24/7', label: 'Monitoring with a human who responds. Attackers don’t keep business hours.' },
]

/** The original site's section headers — they carry "listen" through the story. */
export const SECTIONS = {
  work: { eyebrow: 'Selected work', title: 'Built to be heard.' },
  services: { eyebrow: 'What we do', title: 'Eleven ways to be heard.' },
  voices: { eyebrow: 'Client voices', title: 'We listen. They talk.' },
}

/** How every engagement runs (Software Development process, servicePages.ts). */
export const PROCESS = [
  { title: 'Listen', text: 'We map how work actually flows through your business, not how the org chart says it does.' },
  { title: 'Prototype', text: 'A clickable model in weeks, not months. You react to something real before we build the real thing.' },
  { title: 'Build', text: 'Short cycles, working software at every step. No year-long black box.' },
  { title: 'Support', text: 'We stay after launch, updates, tweaks, and the next idea when you’re ready.' },
]

/**
 * HUD microcopy in Hark's own "hark means listen" voice — deliberately not
 * borrowed from igloo.inc.
 */
/** THEME: give every concept its own microcopy (don't reuse another concept's). */
export const MICROCOPY = {
  signalEyebrow: 'Hark Digital Design',
  scrollHint: 'Scroll to trace the signal',
  audio: 'Sound',
  motion: 'Motion',
  audioOn: 'On',
  audioOff: 'Off',
}

export const SECURITY = {
  eyebrow: 'Hack remediation · Website & data security',
  title: 'Hacked? Breathe.',
  body: 'We find the breach, clean the infection, restore your site, and lock the door behind us. Then we keep watch, hardening, monitoring, and backups, so it never happens again.',
  cta: 'Emergency cleanup →',
  href: 'mailto:mike@hark.digital?subject=Emergency%3A%20my%20site%20was%20hacked',
}

export const CONTACT = {
  eyebrow: 'Start a project',
  title: 'Say hello.',
  body: 'Tell us what you are building, fixing, or dreaming up. New project, a site that got hacked, or eyes in the sky, we read every message and reply like a human.',
  href: 'mailto:mike@hark.digital?subject=New%20project',
}
