// Part definitions – each part is a JSON-style object per the spec.
// snapPoints are {x, y, type} relative to the part's top-left corner.
// Each part also has a `props` array describing customizable properties with ranges.

const PARTS = [
  {
    type: 'c-channel',
    label: 'C-Channel',
    description: 'Structural beam',
    color: '#8a8a9a',
    width:  100,
    height: 24,
    // Snap points are generated dynamically based on length – see getEffectiveSnapPoints()
    snapPoints: [], // placeholder; always use getEffectiveSnapPoints()
    props: [
      { key: 'length', label: 'Length', type: 'range', min: 40, max: 240, step: 20, default: 100, unit: 'px' }
    ],
    metadata: {
      name: 'C-Channel',
      description: 'Rigid structural beam. Connect motors and wheels to it.',
    }
  },
  {
    type: 'motor',
    label: 'Motor',
    description: 'Drives wheels',
    color: '#c0392b',
    width:  44,
    height: 48,
    snapPoints: [
      { x: 22, y:  0, type: 'female', subtype: 'mount',  connectsTo: ['hole'] },  // top mount
      { x: 22, y: 48, type: 'male',   subtype: 'shaft',  connectsTo: ['hub'] },   // output shaft (wheel)
      { x:  0, y: 22, type: 'female', subtype: 'mount',  connectsTo: ['hole'] },  // left mount
      { x: 44, y: 22, type: 'female', subtype: 'mount',  connectsTo: ['hole'] },  // right mount
      { x:  0, y: 38, type: 'female', subtype: 'mount',  connectsTo: ['hole'] },  // lower-left
      { x: 44, y: 38, type: 'female', subtype: 'mount',  connectsTo: ['hole'] },  // lower-right
    ],
    props: [
      { key: 'motorName', label: 'Motor Name', type: 'text', default: '', placeholder: 'e.g. Left Motor' },
      { key: 'speed', label: 'Max Speed', type: 'range', min: 1, max: 10, step: 1, default: 5, unit: '' }
    ],
    metadata: {
      name: 'Motor',
      description: 'Powers the wheels. Attach a wheel to its output shaft.',
    }
  },
  {
    type: 'wheel',
    label: 'Wheel',
    description: 'Robot wheel',
    color: '#2c2c2c',
    width:  40,
    height: 40,
    // Snap points regenerated dynamically based on diameter
    snapPoints: [],
    props: [
      { key: 'diameter', label: 'Diameter', type: 'range', min: 24, max: 64, step: 4, default: 40, unit: 'px' },
      { key: 'traction', label: 'Traction',  type: 'range', min: 1,  max: 10, step: 1, default: 5, unit: '' }
    ],
    metadata: {
      name: 'Wheel',
      description: 'Attaches to a motor output shaft.',
    }
  },
  {
    type: 'battery',
    label: 'Battery',
    description: 'Power source',
    color: '#27ae60',
    width:  60,
    height: 32,
    snapPoints: [
      { x: 15, y:  0, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // top-left region
      { x: 45, y:  0, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // top-right region
      { x: 15, y: 32, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // bottom-left
      { x: 45, y: 32, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // bottom-right
      { x:  0, y: 16, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // left side
      { x: 60, y: 16, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // right side (terminal)
    ],
    props: [
      { key: 'capacity', label: 'Capacity', type: 'range', min: 1, max: 10, step: 1, default: 5, unit: '' }
    ],
    metadata: {
      name: 'Battery',
      description: 'Powers motors and sensors.',
    }
  },
  {
    type: 'distance-sensor',
    label: 'Distance Sensor',
    description: 'Detects obstacles',
    color: '#2980b9',
    width:  40,
    height: 26,
    snapPoints: [
      { x: 20, y: 26, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // bottom mount
      { x:  0, y: 13, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // left
      { x: 40, y: 13, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // right
      { x:  0, y:  0, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // top-left corner
      { x: 40, y:  0, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // top-right corner
    ],
    props: [
      { key: 'range', label: 'Max Range', type: 'range', min: 50, max: 400, step: 25, default: 300, unit: 'px' }
    ],
    metadata: {
      name: 'Distance Sensor',
      description: 'Measures distance to nearest obstacle ahead.',
    }
  },
  {
    type: 'brain',
    label: 'Brain',
    description: 'Robot controller',
    color: '#7c3aed',
    width:  48,
    height: 48,
    snapPoints: [
      { x: 24, y:  0, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // top
      { x: 24, y: 48, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // bottom
      { x:  0, y: 24, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // left
      { x: 48, y: 24, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // right
      { x:  0, y:  0, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // top-left
      { x: 48, y:  0, type: 'female', subtype: 'mount', connectsTo: ['hole'] },  // top-right
    ],
    props: [],
    metadata: {
      name: 'Brain',
      description: 'The robot\'s controller. Wire a battery to it for power, then wire motors and sensors to it.',
    }
  }
];

function getPartDef(type) {
  return PARTS.find(p => p.type === type) || null;
}
