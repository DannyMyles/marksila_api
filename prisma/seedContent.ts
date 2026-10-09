/**
 * Starter website content for each app: business details, editable page
 * copy (App.settings), services/packages, FAQs and banners. Everything is
 * idempotent — existing rows and settings an admin has already edited are
 * left untouched — and all of it can be changed from the admin portal.
 *
 * Corporate offerings default to "price on quotation": real prices are
 * business decisions, set them in Admin → Services.
 */
import { PrismaClient, PricingType, ServiceAudience } from '@prisma/client';
import { slugify } from '../src/utils/slugify';
import type { SiteSettings } from '../src/services/siteSettings';

interface PackageSeed {
  name: string;
  description?: string;
  priceAmount?: number;
  pricingType?: PricingType;
  priceLabel?: string;
  minParticipants?: number;
  maxParticipants?: number;
  features?: string[];
  popular?: boolean;
}

interface ServiceSeed {
  title: string;
  description: string;
  features: string[];
  price: string;
  priceAmount?: number;
  pricingType?: PricingType;
  category: string;
  audience: ServiceAudience;
  image: string;
  icon?: string;
  duration?: string;
  groupSize?: string;
  schedule?: string;
  level?: string;
  location?: string;
  minParticipants?: number;
  maxParticipants?: number;
  bookingRequirements?: string;
  popular?: boolean;
  packages?: PackageSeed[];
}

interface FaqSeed {
  question: string;
  answer: string;
  category?: string;
}

interface AppContent {
  tagline: string;
  contactPhone: string;
  contactEmail: string;
  location: string;
  enquiryPrefix: string;
  settings: SiteSettings;
  services: ServiceSeed[];
  faqs: FaqSeed[];
  banners: { placement: string; title: string; subtitle: string; badge?: string; imageUrl: string; ctaLabel: string; ctaUrl: string }[];
  /** Existing services whose new descriptive fields should be backfilled (matched by title). */
  backfill?: Record<string, Partial<ServiceSeed>>;
}

const QUOTE = { price: 'Price on quotation', pricingType: 'quote' as PricingType };

const fitness: AppContent = {
  tagline: 'Train hard. Live strong.',
  contactPhone: '+254 701 437 959',
  contactEmail: 'markotundo777@gmail.com',
  location: 'Nairobi, Kenya',
  enquiryPrefix: 'MKE',
  settings: {
    brand: { primaryColor: '#FF6B35', secondaryColor: '#0BA154' },
    hero: {
      eyebrow: 'Professional Fitness Training in Nairobi',
      title: 'Train Hard, Live Strong.',
      highlight: 'Your Body, Your Rules.',
      subtitle:
        'Personalized training programs, expert nutrition planning, and unwavering motivation — everything you need to transform your fitness, on your terms.',
      primaryCtaLabel: 'Explore services',
      primaryCtaUrl: '/services',
      secondaryCtaLabel: 'Corporate wellness',
      secondaryCtaUrl: '/corporate',
      perks: ['Motivation', 'Nutrition', 'Strength'],
    },
    social: {
      instagram: 'https://www.instagram.com/marksila254',
      tiktok: 'https://www.tiktok.com/@marksila254',
      facebook: 'https://www.facebook.com/share/14icQAkqW4y/?mibextid=wwXIfr',
    },
    hours: 'Mon–Sat, 5am – 9pm',
    secondaryEmail: 'bookings@marksila254.com',
    about: {
      headline: 'Certified personal training with a personal touch',
      body: 'Marksila254 helps people across Nairobi get fitter, stronger and healthier through personal training, group classes, nutrition coaching and outdoor adventures.',
      story:
        "I started my fitness journey over a decade ago, driven by a personal transformation that changed my life. What began as a personal quest for better health quickly turned into a passion for helping others achieve their goals.\n\nThrough years of dedicated study, certification, and hands-on experience, I've developed training methodologies that deliver real results. My approach combines scientific training principles with practical nutrition guidance to create sustainable lifestyle changes.\n\nWhether you're looking to lose weight, build muscle, improve athletic performance, or simply feel more energetic, I'm here to guide you every step of the way.",
    },
    pages: {
      about: { eyebrow: 'Certified Personal Trainer', title: 'About Marksila254', subtitle: 'Passionate about helping people transform their lives through fitness, proper nutrition, and sustainable lifestyle changes.' },
      services: { eyebrow: 'Professional Services', title: 'My Services', subtitle: 'Professional fitness services tailored to help you achieve your health and wellness goals.' },
      events: { eyebrow: 'Upcoming Events', title: 'Fitness Events', subtitle: 'Join our upcoming training sessions, workshops, and fitness events. Reserve your spot and be part of the community.' },
      gallery: { eyebrow: 'Gallery', title: 'Photo & Video Gallery', subtitle: 'Explore moments from training sessions, client transformations, fitness events, and more.' },
      blog: { eyebrow: 'Blog', title: 'The Blog', subtitle: 'Training advice, nutrition tips, and updates from the Marksila254 team.' },
      contact: { eyebrow: 'Get In Touch', title: 'Ready to Transform?', subtitle: "Contact me today and let's discuss how I can help you achieve your fitness goals." },
    },
    stats: [
      { value: '100+', label: 'Clients Transformed' },
      { value: '10', label: 'Years Experience' },
      { value: '2', label: 'Certifications' },
      { value: '98%', label: 'Success Rate' },
    ],
    steps: [
      { title: 'Consultation', text: 'Free initial consultation to discuss your goals and assess your needs.' },
      { title: 'Custom Plan', text: 'Receive a personalized training and nutrition plan tailored to you.' },
      { title: 'Training', text: 'Begin your training program with ongoing support and adjustments.' },
      { title: 'Results', text: 'Achieve your goals and maintain your new healthy lifestyle.' },
    ],
    values: [
      { title: 'Client-First', text: 'Every program is tailored to your unique goals, fitness level, and lifestyle.' },
      { title: 'Results Driven', text: 'We focus on measurable progress and sustainable results, not quick fixes.' },
      { title: 'Expert Knowledge', text: 'Certified training with up-to-date techniques in fitness and nutrition.' },
      { title: 'Energy & Passion', text: 'Bringing enthusiasm and motivation to every session we conduct.' },
    ],
    highlights: [
      { title: 'Modern Equipment', text: 'State-of-the-art fitness equipment for optimal training results' },
      { title: 'Personalized Plans', text: 'Customized workout and nutrition plans tailored to your goals' },
      { title: 'Online Support', text: 'Virtual support and guidance for your fitness journey' },
      { title: 'Flexible Schedule', text: 'Training sessions available early morning to late evening' },
    ],
    corporate: {
      headline: 'Healthier teams, stronger companies',
      subtitle:
        'Corporate fitness, wellness days, team-building and outdoor adventures for organisations of every size — at your office, in the gym or out on the trail.',
      imageUrl: '/images/011.jpeg',
      minGroupForQuote: 30,
    },
    booking: {
      whatsappNotice: 'Opening WhatsApp does not confirm your booking — we will reply to confirm availability, price and payment.',
      successMessage: "Request received! We'll get back to you shortly to confirm.",
    },
    email: {
      footerNote: 'You are receiving this email because you contacted or booked with Marksila254.',
      signature: 'Mark & the Marksila254 team',
    },
  },
  backfill: {
    'Personal Training': { category: 'Personal Training', audience: 'individual', priceAmount: 2000, pricingType: 'fixed', duration: '60 min' },
    'Group Classes': { category: 'Group Fitness', audience: 'both', priceAmount: 500, pricingType: 'per_person', duration: '45–60 min' },
    'Nutrition Coaching': { category: 'Nutrition', audience: 'individual', priceAmount: 3000, pricingType: 'fixed', duration: 'Monthly' },
    'Online Training': { category: 'Online', audience: 'individual', priceAmount: 5000, pricingType: 'fixed', duration: 'Monthly' },
    'Weight Loss Program': { category: 'Programmes', audience: 'individual', priceAmount: 15000, pricingType: 'fixed', duration: 'Monthly' },
    'Muscle Building': { category: 'Programmes', audience: 'individual', priceAmount: 18000, pricingType: 'fixed', duration: 'Monthly' },
  },
  services: [
    {
      title: 'Corporate Hiking & Nature Walks',
      description: 'Guided hikes, nature walks and outdoor adventures that get your team out of the office and moving together — planned for every fitness level.',
      features: ['Guided hikes with safety support', 'Routes for all fitness levels', 'Group hiking challenges', 'Transport can be arranged'],
      ...QUOTE,
      category: 'Corporate Hiking',
      audience: 'corporate',
      image: '/images/001.jpg',
      icon: 'Mountain',
      duration: 'Half or full day',
      groupSize: '10–200 people',
      minParticipants: 10,
      bookingRequirements: 'Preferred date, number of participants and fitness level of the group.',
      popular: true,
      packages: [
        { name: 'Nature Walk', description: 'An easy-paced guided walk — ideal for mixed-ability teams.', ...QUOTE, priceLabel: 'On quotation' },
        { name: 'Adventure Hike', description: 'A full-day guided hike with a team challenge on the trail.', ...QUOTE, priceLabel: 'On quotation', popular: true },
      ],
    },
    {
      title: 'Corporate Fitness Programmes',
      description: 'Group gym sessions, office workouts, HIIT, aerobics, circuit and strength training run by certified trainers for your staff.',
      features: ['HIIT & circuit training', 'Aerobics & strength sessions', 'Programmes for all levels', 'Progress check-ins'],
      ...QUOTE,
      category: 'Corporate Fitness',
      audience: 'corporate',
      image: '/images/011.jpeg',
      icon: 'Dumbbell',
      duration: '45–60 min sessions',
      groupSize: '5–50 per session',
      minParticipants: 5,
      bookingRequirements: 'Number of participants, preferred days/times and venue (our gym or your premises).',
      packages: [
        { name: 'Single Session', ...QUOTE, priceLabel: 'On quotation' },
        { name: 'Monthly Programme', description: 'Weekly sessions for a month with a consistent trainer.', ...QUOTE, priceLabel: 'On quotation', popular: true },
      ],
    },
    {
      title: 'Team-Building Activities',
      description: 'Obstacle courses, relay races, treasure hunts, navigation challenges and collaborative problem-solving games that build trust and teamwork.',
      features: ['Obstacle courses & relay races', 'Treasure hunts & navigation challenges', 'Problem-solving games', 'Facilitated debrief'],
      ...QUOTE,
      category: 'Team Building',
      audience: 'corporate',
      image: '/images/014.jpg',
      icon: 'Users',
      duration: 'Half or full day',
      groupSize: '10–300 people',
      minParticipants: 10,
      bookingRequirements: 'Group size, preferred date, venue preference and any goals for the day.',
      popular: true,
    },
    {
      title: 'Employee Wellness Days',
      description: 'Yoga, stretching, mobility, meditation and wellness activities to help your people recharge, reduce stress and feel their best.',
      features: ['Yoga & stretching', 'Mobility sessions', 'Guided meditation', 'Wellness talks'],
      ...QUOTE,
      category: 'Wellness Days',
      audience: 'corporate',
      image: '/images/006.JPG',
      icon: 'Heart',
      duration: '2 hours – full day',
      groupSize: '10–150 people',
      minParticipants: 10,
      bookingRequirements: 'Number of participants, preferred date and venue.',
    },
    {
      title: 'Corporate Fitness Challenges',
      description: 'Step-count competitions, fun runs, charity walks and interdepartmental competitions that keep the whole organisation motivated.',
      features: ['Step-count competitions', 'Fun runs & charity walks', 'Interdepartmental leaderboards', 'Prize-giving support'],
      ...QUOTE,
      category: 'Fitness Challenges',
      audience: 'corporate',
      image: '/images/007.JPG',
      icon: 'Award',
      duration: '1 day – 8 weeks',
      groupSize: '20+ people',
      minParticipants: 20,
      bookingRequirements: 'Challenge format, number of participants and preferred start date.',
    },
    {
      title: 'Office Fitness Programmes',
      description: 'Scheduled fitness sessions run at your company premises — no commute, no excuses.',
      features: ['Sessions at your office', 'Before/after work or lunchtime', 'Minimal equipment needed', 'Regular schedule'],
      ...QUOTE,
      category: 'Office Fitness',
      audience: 'corporate',
      image: '/images/025.JPG',
      icon: 'Clock',
      duration: '30–60 min sessions',
      groupSize: '5–40 per session',
      minParticipants: 5,
      bookingRequirements: 'Office location, available space, preferred days/times and number of participants.',
    },
    {
      title: 'Corporate Gym Memberships',
      description: 'Group subscriptions, employee discounts and recurring fitness packages for your team.',
      features: ['Group subscriptions', 'Employee discounts', 'Recurring monthly billing', 'Flexible headcount'],
      ...QUOTE,
      category: 'Gym Memberships',
      audience: 'corporate',
      image: '/images/028.JPG',
      icon: 'Dumbbell',
      groupSize: '5+ employees',
      minParticipants: 5,
      bookingRequirements: 'Number of employees and preferred membership length.',
      packages: [
        { name: 'Starter', description: 'For small teams getting started.', ...QUOTE, priceLabel: 'On quotation', minParticipants: 5, maxParticipants: 15 },
        { name: 'Team', description: 'For growing teams.', ...QUOTE, priceLabel: 'On quotation', minParticipants: 16, maxParticipants: 50, popular: true },
        { name: 'Enterprise', description: 'For large organisations.', ...QUOTE, priceLabel: 'On quotation', minParticipants: 51 },
      ],
    },
    {
      title: 'Leadership Retreats & Adventure Days',
      description: 'Structured outdoor experiences and facilitated team-building sessions for leadership teams.',
      features: ['Facilitated sessions', 'Outdoor challenges', 'Planning & reflection time', 'Custom itinerary'],
      ...QUOTE,
      category: 'Leadership Retreats',
      audience: 'corporate',
      image: '/images/003.jpg',
      icon: 'Star',
      duration: '1–3 days',
      groupSize: '5–40 people',
      minParticipants: 5,
      bookingRequirements: 'Number of participants, preferred dates, location preferences and goals for the retreat.',
    },
    {
      title: 'Family Adventure Days',
      description: 'Hiking and outdoor activities for employees and their families — a fun way to say thank you.',
      features: ['Activities for all ages', 'Guided hikes & games', 'Safety-first planning', 'Optional catering coordination'],
      ...QUOTE,
      category: 'Family Days',
      audience: 'corporate',
      image: '/images/002.jpg',
      icon: 'Heart',
      duration: 'Full day',
      groupSize: '20–300 people',
      minParticipants: 20,
      bookingRequirements: 'Approximate number of adults and children, preferred date and location.',
    },
  ],
  faqs: [
    { question: 'How do I book a session or programme?', answer: 'Choose a service, fill in the short booking form and we will open WhatsApp with your details. We confirm availability, price and payment with you there.', category: 'Booking' },
    { question: 'Is my booking confirmed when I open WhatsApp?', answer: 'Not yet — your request is saved and we reply to confirm. You will also receive a confirmation email if you gave us your email address.', category: 'Booking' },
    { question: 'How do I pay?', answer: 'We agree payment details with you once your booking is confirmed. There is no online payment on the website.', category: 'Payments' },
    { question: 'Do you offer corporate wellness and team-building?', answer: 'Yes — corporate fitness, wellness days, team-building, fitness challenges, office sessions and group memberships. Request a quote from the Corporate page and we will tailor it to your team.', category: 'Corporate' },
    { question: 'Can you run sessions at our office?', answer: 'Yes. Our office fitness programmes run at your premises on a schedule that suits your team.', category: 'Corporate' },
  ],
  banners: [
    {
      placement: 'home',
      title: 'Corporate wellness & team-building',
      subtitle: 'Fitness programmes, wellness days and outdoor adventures for your team. Request a tailored quote.',
      badge: 'For companies',
      imageUrl: '/images/011.jpeg',
      ctaLabel: 'Explore corporate packages',
      ctaUrl: '/corporate',
    },
  ],
};

const sos: AppContent = {
  tagline: 'Fun & fitness adventures in Kenya',
  contactPhone: '+254 701 437 959',
  contactEmail: 'info@sourceofadventure.com',
  location: 'Nairobi, Kenya',
  enquiryPrefix: 'SOE',
  settings: {
    brand: { primaryColor: '#EA580C', secondaryColor: '#059669' },
    hero: {
      eyebrow: 'Fun & Fitness Adventures · Kenya',
      title: 'Get outside.',
      highlight: 'Get stronger.',
      subtitle: 'Hikes, rafting, rides and climbs with a crew that keeps it fun. Pick a date, add your name and phone, and confirm your spot on WhatsApp.',
      imageUrl: '/all.jpeg',
      primaryCtaLabel: 'Find an adventure',
      primaryCtaUrl: '/adventures',
      secondaryCtaLabel: 'Chat with us',
      perks: ['No account needed', 'Pay once confirmed', 'Groups welcome'],
    },
    hours: 'Mon–Sat, 6am – 8pm',
    about: {
      headline: 'Fitness, but make it an adventure',
      body: 'Where passion for the outdoors meets excellence in fitness training.',
      mission:
        'To inspire individuals to transform their fitness journey into an adventure, combining expert training with exciting physical challenges that build strength, confidence, and vitality.',
      vision:
        'Creating a world where fitness is not a chore but an adventure, where every workout brings joy and every achievement builds a stronger, healthier community.',
      imageUrl: '/all.jpeg',
    },
    pages: {
      adventures: { eyebrow: 'Adventures & Tours', title: 'Find your next', highlight: 'adventure', subtitle: 'Pick a trip, tell us how many are coming, and confirm on WhatsApp — no account, no online payment.', imageUrl: 'https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=2000' },
      calendar: { eyebrow: 'Adventure Calendar', title: 'Plan it by', highlight: 'date', subtitle: 'See every upcoming adventure, check open spots and reserve yours.', imageUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=2000' },
      activities: { eyebrow: 'Activities & classes', title: 'Something for', highlight: 'every pace', subtitle: 'From easy nature walks to adrenaline-pumping climbs and open-air fitness classes.', imageUrl: 'https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&w=2000' },
      aerobics: { eyebrow: 'Outdoor Aerobics', title: 'Train in the', highlight: 'fresh air', subtitle: 'Fitness in its natural habitat — open skies, real terrain and energising group sessions.', imageUrl: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=2000' },
      gallery: { eyebrow: 'Gallery', title: 'Moments from the', highlight: 'trail', subtitle: 'The crew, the climbs, the rivers and the views — a look at life on our adventures.', imageUrl: 'https://images.unsplash.com/photo-1530866495561-507c9faab2ed?auto=format&fit=crop&w=2000' },
      about: { eyebrow: 'About us', title: 'Fitness, but make it an', highlight: 'adventure', subtitle: 'Where passion for the outdoors meets excellence in fitness training.', imageUrl: '/all.jpeg' },
      events: { eyebrow: 'Events', title: 'Join the', highlight: 'crew', subtitle: 'Fun runs, community hikes, workshops and meet-ups — pick a date and save your spot.', imageUrl: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?auto=format&fit=crop&w=2000' },
      corporate: { eyebrow: 'Corporate & groups', title: 'Adventures for', highlight: 'your team', subtitle: 'Guided hikes, team-building challenges and adventure days for companies, schools and groups.', imageUrl: 'https://images.unsplash.com/photo-1522163182402-834f871fd851?auto=format&fit=crop&w=2000' },
      contact: { eyebrow: 'Contact', title: 'Let’s plan your', highlight: 'trip', subtitle: 'Questions, group bookings or a private adventure — we usually reply within the hour on WhatsApp.', imageUrl: 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?auto=format&fit=crop&w=2000' },
    },
    team: [
      {
        name: 'Mark Sila',
        role: 'Certified Personal Trainer',
        bio: 'With over 6 years in fitness education, Mark specializes in high-energy aerobics and personalized training programs. His dynamic approach transforms fitness routines into exhilarating experiences that build strength, endurance, and confidence.',
        imageUrl: '/mark.jpeg',
        expertise: ['Personal Training', 'Aerobics Instruction', 'Cardio Conditioning', 'Fitness Programming'],
      },
      {
        name: 'Teddy Mist',
        role: 'Fitness & Wellness Coach',
        bio: 'Certified personal trainer and yoga instructor specializing in adventure fitness. Teddy designs programs that prepare both body and mind for outdoor challenges.',
        imageUrl: '/teddy.jpeg',
        expertise: ['Fitness Training', 'Yoga & Mobility', 'Nutrition Planning', 'Mindfulness'],
      },
      {
        name: 'Edu Shark',
        role: 'Water Sports & Survival Expert',
        bio: 'Navy veteran and professional dive instructor with expertise in all things aquatic. Edu Shark ensures safety while maximizing fun on water adventures.',
        imageUrl: '/edu.jpeg',
        expertise: ['Scuba Diving', 'Survival Training', 'Marine Conservation', 'Water Safety'],
      },
    ],
    steps: [
      { title: 'Pick an adventure', text: 'Browse upcoming hikes, rides, climbs and water trips.' },
      { title: 'Add your details', text: 'Name, phone and how many people — that’s it. No account.' },
      { title: 'Confirm on WhatsApp', text: 'Your booking opens in WhatsApp. Tap Send and we confirm your spot.' },
    ],
    values: [
      { title: 'Personalized Approach', text: 'Custom programs tailored to your fitness level and adventure goals' },
      { title: 'High-Energy Sessions', text: 'Dynamic aerobics and cardio that keep workouts exciting and effective' },
      { title: 'Adventure Integration', text: 'Training that prepares you for real-world challenges and outdoor activities' },
      { title: 'Expert Training', text: 'Professional guidance from certified fitness experts' },
      { title: 'Energy & Fun', text: 'High-energy workouts that make fitness enjoyable' },
      { title: 'Adventure Spirit', text: 'Every workout is a step toward your next adventure' },
    ],
    highlights: [
      { title: 'Fresh Air', text: 'Increased oxygen intake boosts energy levels' },
      { title: 'Vitamin D', text: 'Natural sunlight for bone health and mood' },
      { title: 'Mental Clarity', text: 'Nature reduces stress and improves focus' },
      { title: 'Varied Terrain', text: 'Natural surfaces challenge balance and stability' },
      { title: 'Social Connection', text: 'Community building in beautiful settings' },
      { title: 'Sustainability', text: 'Eco-friendly workouts without electricity' },
    ],
    corporate: {
      headline: 'Team adventures that people actually talk about',
      subtitle: 'Guided hikes, outdoor team-building, adventure days and retreats for companies, schools and groups — planned, guided and safety-first.',
      imageUrl: '/all.jpeg',
      minGroupForQuote: 20,
    },
    booking: {
      whatsappNotice: 'Opening WhatsApp does not confirm your booking — we reply to confirm your spot and payment.',
      successMessage: 'Request received! We will confirm shortly.',
    },
    email: {
      footerNote: 'You are receiving this email because you booked or contacted Source of Adventure.',
      signature: 'The Source of Adventure crew',
    },
  },
  services: [
    { title: 'Guided Nature Walks', description: 'Gentle walks with naturalist guides exploring local flora and fauna.', features: ['Naturalist guide', 'Easy pace', 'Small groups'], ...QUOTE, price: 'Price on request', category: 'Outdoor Activity', audience: 'both', image: 'https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=800', duration: '2-3 hours', groupSize: 'Small groups', level: 'Beginner' },
    { title: 'Rock Climbing', description: 'Beginner to advanced climbing on natural rock formations.', features: ['Professional guides', 'All gear provided', 'Safety briefing'], ...QUOTE, price: 'Price on request', category: 'Outdoor Activity', audience: 'both', image: 'https://images.unsplash.com/photo-1522163182402-834f871fd851?auto=format&fit=crop&w=800', duration: 'Half/Full day', groupSize: '4-8 people', level: 'All levels', maxParticipants: 8 },
    { title: 'Kayaking', description: 'Explore lakes, rivers, and coastal waters.', features: ['Kayaks & life jackets', 'Instruction included', 'Scenic routes'], ...QUOTE, price: 'Price on request', category: 'Outdoor Activity', audience: 'both', image: 'https://images.unsplash.com/photo-1472745433479-4556f22e32c2?auto=format&fit=crop&w=800', duration: '3-4 hours', groupSize: '2-12 people', maxParticipants: 12 },
    { title: 'Mountain Biking', description: 'Trail riding through forests and mountains.', features: ['Trail guide', 'Routes for every level', 'Bike hire available'], ...QUOTE, price: 'Price on request', category: 'Outdoor Activity', audience: 'both', image: 'https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&w=800', duration: '2-6 hours', groupSize: '2-10 people', maxParticipants: 10 },
    { title: 'Wildlife Photography', description: 'Learn photography while observing wildlife in natural habitats.', features: ['Photography tips', 'Wildlife spotting', 'Small groups'], ...QUOTE, price: 'Price on request', category: 'Outdoor Activity', audience: 'individual', image: 'https://images.unsplash.com/photo-1520095972714-909e91b038e5?auto=format&fit=crop&w=800', duration: '3-4 hours', groupSize: '4-8 people', maxParticipants: 8 },
    { title: 'Survival Skills', description: 'Learn essential wilderness survival techniques.', features: ['Shelter & fire basics', 'Navigation', 'Hands-on practice'], ...QUOTE, price: 'Price on request', category: 'Outdoor Activity', audience: 'both', image: 'https://images.unsplash.com/photo-1536939459926-301728717817?auto=format&fit=crop&w=800', duration: 'Full day', groupSize: '6-12 people', maxParticipants: 12 },
    { title: 'Outdoor HIIT', description: 'High-intensity interval training in nature.', features: ['Coach-led', 'Bodyweight & bands', 'All levels'], ...QUOTE, price: 'Price on request', category: 'Outdoor Fitness', audience: 'both', image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=800', schedule: 'Mon, Wed, Fri | 6:00 AM', level: 'All Levels', duration: '45 min' },
    { title: 'Trail Running', description: 'Cardio endurance through scenic trails.', features: ['Pace groups', 'Scenic trails', 'Coach-led'], ...QUOTE, price: 'Price on request', category: 'Outdoor Fitness', audience: 'both', image: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?auto=format&fit=crop&w=800', schedule: 'Tue, Thu, Sat | 7:00 AM', level: 'Intermediate', duration: '60 min' },
    { title: 'Park Yoga Flow', description: 'Vinyasa yoga in natural surroundings.', features: ['Bring a mat', 'Breathwork', 'Beginner friendly'], ...QUOTE, price: 'Price on request', category: 'Outdoor Fitness', audience: 'both', image: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=800', schedule: 'Daily | 8:00 AM', level: 'Beginner', duration: '60 min' },
    { title: 'Outdoor Bootcamp', description: 'Full-body strength and conditioning.', features: ['Strength & conditioning', 'Team drills', 'Progress tracking'], ...QUOTE, price: 'Price on request', category: 'Outdoor Fitness', audience: 'both', image: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=800', schedule: 'Mon-Fri | 5:30 PM', level: 'Advanced', duration: '50 min' },
    { title: 'Sunrise Stretch', description: 'Morning mobility and flexibility.', features: ['Mobility', 'Flexibility', 'Gentle start to the day'], ...QUOTE, price: 'Price on request', category: 'Outdoor Fitness', audience: 'both', image: 'https://images.unsplash.com/photo-1522898467493-49726bf28798?auto=format&fit=crop&w=800', schedule: 'Daily | 6:30 AM', level: 'All Levels', duration: '30 min' },
    { title: 'Corporate Team Hikes', description: 'Guided hikes and nature walks for teams of every fitness level, with a team challenge on the trail.', features: ['Experienced guides & safety support', 'Routes for all fitness levels', 'Trail team challenge', 'Transport can be arranged'], ...QUOTE, category: 'Corporate Hiking', audience: 'corporate', image: 'https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=1200', duration: 'Half or full day', groupSize: '10–200 people', minParticipants: 10, popular: true, bookingRequirements: 'Group size, preferred date and the fitness level of the group.',
      packages: [
        { name: 'Nature Walk', description: 'Easy-paced guided walk — great for mixed-ability teams.', ...QUOTE, priceLabel: 'On quotation' },
        { name: 'Summit Challenge', description: 'A full-day guided hike with team challenges along the way.', ...QUOTE, priceLabel: 'On quotation', popular: true },
      ] },
    { title: 'Outdoor Team-Building', description: 'Obstacle courses, relay races, treasure hunts, navigation challenges and problem-solving games outdoors.', features: ['Obstacle courses & relays', 'Treasure hunts & navigation', 'Problem-solving games', 'Facilitated debrief'], ...QUOTE, category: 'Team Building', audience: 'corporate', image: 'https://images.unsplash.com/photo-1530866495561-507c9faab2ed?auto=format&fit=crop&w=1200', duration: 'Half or full day', groupSize: '10–300 people', minParticipants: 10, bookingRequirements: 'Group size, preferred date, venue preference and goals for the day.' },
    { title: 'Corporate Adventure Days', description: 'Rafting, cycling, climbing or kayaking days built around your team — fully guided with all gear provided.', features: ['Rafting, cycling, climbing or kayaking', 'All gear & guides provided', 'Safety briefing', 'Optional catering coordination'], ...QUOTE, category: 'Adventure Days', audience: 'corporate', image: 'https://images.unsplash.com/photo-1541625602330-2277a4c46182?auto=format&fit=crop&w=1200', duration: 'Full day', groupSize: '8–80 people', minParticipants: 8, bookingRequirements: 'Preferred activity, group size and date.' },
    { title: 'Leadership Retreats', description: 'Structured outdoor experiences and facilitated sessions for leadership teams, over one to three days.', features: ['Facilitated sessions', 'Outdoor challenges', 'Reflection & planning time', 'Custom itinerary'], ...QUOTE, category: 'Retreats', audience: 'corporate', image: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1200', duration: '1–3 days', groupSize: '5–40 people', minParticipants: 5, bookingRequirements: 'Number of participants, preferred dates and goals for the retreat.' },
    { title: 'Family & Staff Fun Days', description: 'Outdoor games, hikes and activities for employees and their families.', features: ['Activities for all ages', 'Guided walks & games', 'Safety-first planning', 'Flexible venues'], ...QUOTE, category: 'Fun Days', audience: 'corporate', image: 'https://images.unsplash.com/photo-1536939459926-301728717817?auto=format&fit=crop&w=1200', duration: 'Full day', groupSize: '20–300 people', minParticipants: 20, bookingRequirements: 'Approximate number of adults and children, preferred date and location.' },
    { title: 'Adventure Circuits', description: 'Functional fitness with natural elements.', features: ['Functional movements', 'Natural obstacles', 'Small groups'], ...QUOTE, price: 'Price on request', category: 'Outdoor Fitness', audience: 'both', image: 'https://images.unsplash.com/photo-1599058917765-a780eda07a3e?auto=format&fit=crop&w=800', schedule: 'Weekends | 9:00 AM', level: 'Intermediate', duration: '75 min' },
  ],
  faqs: [
    { question: 'Do I need an account to book?', answer: 'No. Pick an adventure, add your name, phone and number of people, and confirm on WhatsApp.', category: 'Booking' },
    { question: 'Is my spot confirmed when I open WhatsApp?', answer: 'Your spots are held when you submit the form, and we confirm the booking in the WhatsApp chat. If you add your email, you will get a confirmation email too.', category: 'Booking' },
    { question: 'How do I pay?', answer: 'We agree payment with you on WhatsApp once your spot is confirmed. There is no online payment on the website.', category: 'Payments' },
    { question: 'Can I book for a group?', answer: 'Yes — choose how many people when you book. For large or private groups, send us a message and we will tailor the trip.', category: 'Groups' },
    { question: 'Do you organise corporate team-building?', answer: 'Yes — team hikes, outdoor team-building, adventure days, leadership retreats and family fun days. Request a quote from the Corporate page and we will tailor the day to your team.', category: 'Corporate' },
    { question: 'How are corporate trips priced?', answer: 'By quotation, based on group size, activity, location and transport. You get a clear quote before anything is booked.', category: 'Corporate' },
  ],
  banners: [],
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Defaults under existing values, one level deep (e.g. a new about.story). */
function fillMissing(defaults: Record<string, unknown>, existing: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...defaults, ...existing };
  for (const [k, v] of Object.entries(defaults)) {
    if (isObject(v) && isObject(existing[k])) out[k] = { ...v, ...(existing[k] as object) };
  }
  return out;
}

async function seedApp(prisma: PrismaClient, key: string, content: AppContent) {
  const app = await prisma.app.findUnique({ where: { key } });
  if (!app) throw new Error(`App "${key}" not found — run \`npm run prisma:deploy\` first.`);

  await prisma.app.update({
    where: { id: app.id },
    data: {
      tagline: app.tagline ?? content.tagline,
      contactPhone: app.contactPhone ?? content.contactPhone,
      contactEmail: app.contactEmail ?? content.contactEmail,
      location: app.location ?? content.location,
      enquiryPrefix: app.enquiryPrefix === 'ENQ' ? content.enquiryPrefix : app.enquiryPrefix,
      // Existing settings keep every value an admin set; only missing sections are added.
      settings: JSON.stringify(fillMissing(content.settings as Record<string, unknown>, app.settings ? JSON.parse(app.settings) : {})),
    },
  });

  for (const [title, fields] of Object.entries(content.backfill ?? {})) {
    await prisma.training.updateMany({
      where: { appId: app.id, title, category: null },
      data: {
        category: fields.category,
        audience: fields.audience,
        priceAmount: fields.priceAmount,
        pricingType: fields.pricingType,
        duration: fields.duration,
      },
    });
  }

  let services = 0;
  const maxOrder = (await prisma.training.aggregate({ where: { appId: app.id }, _max: { order: true } }))._max.order ?? 0;
  for (const [index, s] of content.services.entries()) {
    const slug = slugify(s.title);
    if (await prisma.training.findUnique({ where: { appId_slug: { appId: app.id, slug } } })) continue;
    await prisma.training.create({
      data: {
        appId: app.id,
        title: s.title,
        slug,
        description: s.description,
        features: JSON.stringify(s.features),
        price: s.price,
        priceAmount: s.priceAmount,
        pricingType: s.pricingType ?? 'fixed',
        category: s.category,
        audience: s.audience,
        imageUrl: s.image,
        icon: s.icon,
        duration: s.duration,
        groupSize: s.groupSize,
        schedule: s.schedule,
        level: s.level,
        location: s.location,
        minParticipants: s.minParticipants,
        maxParticipants: s.maxParticipants,
        bookingRequirements: s.bookingRequirements,
        popular: s.popular ?? false,
        order: maxOrder + index + 1,
        packages: {
          create: (s.packages ?? []).map((p, i) => ({
            name: p.name,
            description: p.description,
            priceAmount: p.priceAmount,
            pricingType: p.pricingType ?? 'fixed',
            priceLabel: p.priceLabel,
            minParticipants: p.minParticipants,
            maxParticipants: p.maxParticipants,
            features: JSON.stringify(p.features ?? []),
            popular: p.popular ?? false,
            order: i,
          })),
        },
      },
    });
    services += 1;
  }

  let faqs = 0;
  const existingQuestions = new Set((await prisma.faq.findMany({ where: { appId: app.id }, select: { question: true } })).map((f) => f.question));
  const newFaqs = content.faqs.map((f, order) => ({ ...f, appId: app.id, order })).filter((f) => !existingQuestions.has(f.question));
  if (newFaqs.length) {
    await prisma.faq.createMany({ data: newFaqs });
    faqs = newFaqs.length;
  }

  let banners = 0;
  if ((await prisma.banner.count({ where: { appId: app.id } })) === 0 && content.banners.length) {
    await prisma.banner.createMany({ data: content.banners.map((b, order) => ({ ...b, appId: app.id, order })) });
    banners = content.banners.length;
  }

  console.log(`[${key}] Content: ${services} services, ${faqs} FAQs, ${banners} banners added (existing content kept).`);
}

export async function seedContent(prisma: PrismaClient, only?: string) {
  if (!only || only === 'fitness') await seedApp(prisma, 'fitness', fitness);
  if (!only || only === 'sos') await seedApp(prisma, 'sos', sos);
}
