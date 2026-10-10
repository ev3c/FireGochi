// Propiedades de cada combustible. Unidades: metros, kg, °C, segundos.
// ignition: temperatura de ignición de la superficie.
// inertia: constante de tiempo térmica (cuánto tarda en calentarse).
// flameTime / emberTime: duración nominal de la fase de llama y de brasa.
// volatile: fracción de la masa que arde como llama (el resto queda como carbón).
// demand: oxígeno que consume ardiendo a plena intensidad.
// heatOut: calor que aporta a la habitación.
export const FUELS = {
  paper: {
    name: 'Papel de periódico', short: 'Papel', icon: '📰', shape: 'ball',
    radius: 0.055, mass: 0.03, ignition: 230, inertia: 1.6,
    flameTime: 24, emberTime: 5, volatile: 0.93, flameScale: 0.95, flameCount: 1,
    sparks: 0.15, demand: 0.06, heatOut: 0.3, moisture: 0.05, price: 2,
    desc: 'Prende al instante con una cerilla, pero dura segundos.',
  },
  pinecone: {
    name: 'Piña seca', short: 'Piña', icon: '🌰', shape: 'cone',
    radius: 0.04, length: 0.11, mass: 0.08, ignition: 255, inertia: 9,
    flameTime: 170, emberTime: 160, volatile: 0.72, flameScale: 0.6, flameCount: 1,
    sparks: 0.7, demand: 0.07, heatOut: 0.3, moisture: 0.08, price: 4,
    desc: 'Resinosa: un gran iniciador que aguanta unos minutos.',
  },
  kindling: {
    name: 'Astillas', short: 'Astillas', icon: '🥢', shape: 'stick', count: 4,
    width: 0.024, height: 0.017, length: 0.27, mass: 0.05, ignition: 275, inertia: 22,
    flameTime: 120, emberTime: 80, volatile: 0.75, flameScale: 0.42, flameCount: 1,
    sparks: 0.4, demand: 0.045, heatOut: 0.16, moisture: 0.1, price: 5,
    desc: 'Un manojo de 4 astillas. Puente entre el papel y los troncos.',
  },
  pine_thin: {
    name: 'Rama gruesa de pino', short: 'Rama', icon: '🌿', shape: 'log', species: 'pine',
    radius: 0.03, length: 0.38, mass: 0.35, ignition: 290, inertia: 55,
    flameTime: 620, emberTime: 450, volatile: 0.74, flameScale: 0.7, flameCount: 2,
    sparks: 0.9, demand: 0.13, heatOut: 0.5, moisture: 0.13, price: 8,
    desc: 'Tronco fino. Prende con astillas y anima el fuego.',
  },
  pine: {
    name: 'Tronco de pino', short: 'Pino', icon: '🪵', shape: 'log', species: 'pine',
    radius: 0.055, length: 0.42, mass: 1.3, ignition: 300, inertia: 140,
    flameTime: 1500, emberTime: 1100, volatile: 0.74, flameScale: 1.0, flameCount: 3,
    sparks: 1.2, demand: 0.24, heatOut: 1.0, moisture: 0.14, price: 15,
    desc: 'Llama alegre y viva. Chisporrotea por la resina.',
  },
  birch: {
    name: 'Tronco de abedul', short: 'Abedul', icon: '🪵', shape: 'log', species: 'birch',
    radius: 0.05, length: 0.4, mass: 1.2, ignition: 285, inertia: 120,
    flameTime: 1400, emberTime: 1000, volatile: 0.75, flameScale: 1.08, flameCount: 3,
    sparks: 0.35, demand: 0.23, heatOut: 1.0, moisture: 0.14, price: 20,
    desc: 'Corteza blanca que prende fácil. Llama bonita y luminosa.',
  },
  oak: {
    name: 'Tronco de roble', short: 'Roble', icon: '🪵', shape: 'log', species: 'oak',
    radius: 0.06, length: 0.42, mass: 2.0, ignition: 330, inertia: 210,
    flameTime: 2400, emberTime: 2700, volatile: 0.7, flameScale: 0.85, flameCount: 3,
    sparks: 0.25, demand: 0.24, heatOut: 1.3, moisture: 0.15, price: 30,
    desc: 'Duro y denso. Cuesta prenderlo, pero da calor y brasas durante horas.',
  },
  holm: {
    name: 'Tronco de encina', short: 'Encina', icon: '🪵', shape: 'log', species: 'holm',
    radius: 0.058, length: 0.4, mass: 2.2, ignition: 340, inertia: 240,
    flameTime: 2800, emberTime: 3300, volatile: 0.68, flameScale: 0.8, flameCount: 3,
    sparks: 0.2, demand: 0.24, heatOut: 1.45, moisture: 0.15, price: 40,
    desc: 'La reina de la leña: la brasa más duradera y caliente.',
  },
};

export const FUEL_ORDER = ['paper', 'pinecone', 'kindling', 'pine_thin', 'pine', 'birch', 'oak', 'holm'];

// Humedad a partir de la cual la madera no puede prender.
export const WET_LIMIT = 0.22;
export const WET_MOISTURE = 0.42;
