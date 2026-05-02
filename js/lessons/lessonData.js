// Lesson data for simulation canvas.
// Lessons 1-3 auto-load the starter robot (autoLoadStarter: true).
//
// Obstacle convention:
//   { x, y, width, height, obstacleHeight? }
// All values are in 2D sim pixels (arena is 1500×1500). The optional
// `obstacleHeight` field is in 3D world units and is consumed only by the 3D
// field renderers (testCanvas3D / codeCanvas3D). Omit it for the default
// barrier-height look. Existing lessons without `obstacleHeight` are fully
// backward-compatible.
//
// Coordinates rescaled from the original 440×360 arena by scale factor 3.4090909
// (1500 / 440). Y dimension scaled by the same factor (original 360 → 1227 used,
// ~273 px of blank space at bottom of the new square field — intentional).

const LESSONS = [
  {
    id: 1,
    title: 'First Moves',
    objective: 'Drive your robot forward into the goal zone.',
    content: `
      <p>Welcome to RoboBuilder! A starter robot is loaded for you with two motors and wheels.</p>
      <p>Use the <strong class="block-chip motor">Drive Both Motors</strong> block to spin both motors
         at the same power. Set the <em>power</em> and <em>seconds</em>, then press <strong>Run</strong>.</p>
      <p>Reach the <strong class="block-chip sensor">green goal zone</strong> near the top!</p>
    `,
    hint: 'Try "Drive Both Motors" with power 5 for about 1.5 seconds. Both motors spin together, pushing the robot straight forward.',
    commonMistakes: [
      'Power too low — try 5 or higher.',
      'Duration too short — the robot stops before reaching the goal.',
      'Make sure the block is connected to the "when program starts" block.'
    ],
    starCriteria: { maxTime: 8, maxBlocks: 3 },
    autoLoadStarter: true,
    startPosition: { x: 273, y: 1023, angleDeg: -90 },
    obstacles: [],
    goalZone: { x: 1159, y: 136, width: 273, height: 273 }
  },
  {
    id: 2,
    title: 'Tank Drive Turning',
    objective: 'Use individual motors to turn past the wall and reach the goal.',
    content: `
      <p>A wall blocks the direct path. You need to <strong>turn</strong>!</p>
      <p>Real robots turn by spinning their motors at <em>different speeds</em>. This is called
         <strong>tank drive</strong> (like a tank's treads).</p>
      <p>Try: <strong class="block-chip motor">Drive Both Motors</strong> forward, then
         <strong class="block-chip motor">Spin Motor A</strong> only (the other stays stopped) to
         curve around the wall.</p>
      <p>Experiment: what happens when you spin motors at <em>opposite</em> powers?</p>
    `,
    hint: 'Drive Both Motors (power 5, 1s) to go up. Then Spin Motor A (power 5, 0.8s) to curve right. Then Drive Both Motors again to reach the goal. You can also use Turn Right/Left blocks from the Movement section.',
    commonMistakes: [
      'Driving too far before turning — you\'ll hit the wall.',
      'Using only one motor for too long — the robot curves in a tight circle.',
      'Forgetting to drive again after turning — add another Drive Both Motors block.'
    ],
    starCriteria: { maxTime: 12, maxBlocks: 6 },
    autoLoadStarter: true,
    startPosition: { x: 273, y: 1023, angleDeg: -90 },
    obstacles: [
      { x: 580, y: 136, width: 55, height: 648 }
    ],
    goalZone: { x: 1125, y: 819, width: 273, height: 273 }
  },
  {
    id: 3,
    title: 'Loops',
    objective: 'Drive in a square using a repeat loop.',
    content: `
      <p>Instead of stacking many blocks, use a <strong class="block-chip control">Repeat</strong> loop.</p>
      <p>Put <em>Drive Both Motors</em> and a turn inside a <strong>Repeat 4 times</strong> block
         to trace a square path and land on the goal.</p>
      <p>To turn exactly 90°, you can use the <strong class="block-chip drive">Turn Right</strong>
         block from the Movement section, or spin one motor briefly.</p>
    `,
    hint: 'Repeat 4 times: Drive Both Motors (power 4, 0.7s) then Turn Right (90°). This makes a square!',
    commonMistakes: [
      'Forgetting to put blocks INSIDE the loop — drag them onto the notch.',
      'Using 360° instead of 90° for each turn.',
      'Power too high — the robot overshoots past the arena boundary.'
    ],
    starCriteria: { maxTime: 15, maxBlocks: 5 },
    autoLoadStarter: true,
    startPosition: { x: 682, y: 852, angleDeg: 0 },
    obstacles: [],
    goalZone: { x: 205, y: 205, width: 307, height: 307 }
  },
  {
    id: 4,
    title: 'Sensing',
    objective: 'Use the distance sensor to avoid the wall.',
    content: `
      <p>Your robot has a <strong>distance sensor</strong> (the green ray). It measures how far
         the nearest obstacle is.</p>
      <p>Use <strong class="block-chip sensor">Is Path Clear?</strong> inside an
         <strong class="block-chip control">If / Else</strong> block:
         if clear, drive forward with motors; otherwise, turn.</p>
    `,
    hint: 'Use: if (is path clear? 205px) → Drive Both Motors (power 5, 0.3s), else → Turn Right 90°. Put this in a Repeat 10 times loop.',
    commonMistakes: [
      'Threshold too small (e.g. 70) — robot is already touching the wall before the sensor triggers. Try 170–273.',
      'Threshold too large (e.g. 680) — robot turns far too early and never enters the corridor.',
      'Not looping the if/else — the sensor check only fires once. Wrap it in a Repeat or Forever loop.',
      'Forgetting to put the drive block INSIDE the if — make sure it snaps into the "if" slot, not after it.'
    ],
    starCriteria: { maxTime: 15, maxBlocks: 6 },
    startPosition: { x: 273, y: 1023, angleDeg: -90 },
    obstacles: [
      { x: 546, y: 136, width: 55, height: 648 }
    ],
    goalZone: { x: 1091, y: 819, width: 273, height: 273 }
  },
  {
    id: 5,
    title: 'Repeat Until',
    objective: 'Drive until the robot gets close to the wall.',
    content: `
      <p>The <strong class="block-chip control">Repeat Until</strong> block keeps looping
         until a condition becomes true.</p>
      <p>Use <em>Repeat Until: distance &lt; 136</em> with <em>Drive Both Motors</em> inside —
         the robot stops automatically near the wall.</p>
    `,
    hint: 'Repeat Until: (Get Distance < 136) → inside: Drive Both Motors (power 5, 0.1s). Robot stops when near the wall.',
    commonMistakes: [
      'Threshold too small (e.g. 34) — the robot hits the wall before the condition triggers.',
      'No drive block inside the loop — robot never moves so the condition never changes.',
      'Using "Repeat while" instead of "Repeat until" — they are opposites.'
    ],
    startPosition: { x: 171, y: 614, angleDeg: 0 },
    obstacles: [
      { x: 1125, y: 205, width: 55, height: 819 }
    ],
    goalZone: null
  },
  {
    id: 6,
    title: 'Forever Loop',
    objective: 'Make the robot bounce around the arena.',
    content: `
      <p>A <strong class="block-chip control">Forever</strong> loop runs until you press Stop —
         perfect for robots that always need to be doing something.</p>
      <p>Inside the loop: <em>if path clear → drive forward with motors, else → turn</em>.
         Press <strong>Stop</strong> when you're done.</p>
    `,
    hint: 'Forever: if (is path clear? 170) → Drive Both Motors (power 5, 0.2s); else → Turn Right 90°.',
    commonMistakes: [
      'Drive duration too long (e.g. 1s) — robot overshoots and hits walls before the sensor re-checks. Use 0.1–0.3 seconds.',
      'Threshold too small — robot is too close to react. Try 136–205 pixels.',
      'The Forever loop runs until you press Stop — this is normal! Press Stop when done.',
      'Putting the if/else AFTER the forever loop — it must go INSIDE it.'
    ],
    startPosition: { x: 341, y: 614, angleDeg: 0 },
    obstacles: [
      { x: 648, y: 136, width: 55, height: 512 },
      { x: 648, y: 784, width: 55, height: 375 }
    ],
    goalZone: null
  },
  {
    id: 7,
    title: 'Variables',
    objective: 'Use a variable to count how many times you turn.',
    content: `
      <p>Variables store values you can use and change later.</p>
      <p>Create a variable called <strong>turns</strong>. Set it to 0 before the loop.
         Every time the robot turns, increase <strong>turns</strong> by 1 and
         <em>Say</em> its current value.</p>
    `,
    hint: 'Set turns = 0. Repeat 4 times: Drive Both Motors (power 5, 0.5s) + Turn Right 90° + set turns = turns + 1 + Say turns.',
    commonMistakes: [
      'Forgetting "Set turns = 0" before the loop — it might start at undefined.',
      'Using "Set" instead of "Change by 1" if you prefer the change block.',
      'The Say block updates the status bar below the simulation — look there!'
    ],
    startPosition: { x: 409, y: 886, angleDeg: -90 },
    obstacles: [],
    goalZone: null
  },
  {
    id: 8,
    title: 'Grand Challenge',
    objective: 'Navigate the maze and reach the goal!',
    content: `
      <p>Combine everything you've learned to escape this maze:</p>
      <ul>
        <li><strong class="block-chip sensor">Sensors</strong> to detect walls</li>
        <li><strong class="block-chip motor">Motors</strong> to drive and turn</li>
        <li><strong class="block-chip control">Loops</strong> to keep checking</li>
        <li><strong class="block-chip output">Output</strong> to track your progress</li>
      </ul>
      <p>Reach the <strong class="block-chip sensor">goal zone</strong> in the top-right corner. Good luck!</p>
    `,
    hint: 'Forever loop: if (path clear 273px) → Drive Both Motors (power 4, 0.2s); else → Turn Right 90° then Wait 0.3s.',
    commonMistakes: [
      'Moving too fast in the maze — use power 3–4 and short durations (0.1–0.2s) so the robot checks frequently.',
      'Threshold too large (e.g. 341) — robot turns before entering corridors. Try 170–273.',
      'Not waiting after a turn — add a short Wait (0.2s) so the robot settles before re-checking.',
      'Only turning right — try alternating turn directions or adding a "touching wall?" check.'
    ],
    starCriteria: { maxTime: 30, maxBlocks: 8 },
    arenaWidth: 1909, arenaHeight: 1364,
    startPosition: { x: 171, y: 1227, angleDeg: -90 },
    obstacles: [
      { x: 409,  y: 136, width: 55, height: 614 },
      { x: 409,  y: 886, width: 55, height: 409 },
      { x: 852,  y: 409, width: 55, height: 886 },
      { x: 1295, y: 136, width: 55, height: 614 },
      { x: 464,  y: 136, width: 886, height: 55 },
      { x: 852,  y: 750, width: 498, height: 55 }
    ],
    goalZone: { x: 1602, y: 136, width: 239, height: 239 }
  },
  {
    id: 9,
    title: 'Precise Movements',
    objective: 'Calculate motor timing to travel exact distances.',
    content: `
      <p>Sometimes you need the robot to move a <strong>precise distance</strong>.
         With motors, distance = power × time.</p>
      <p>Use <strong class="block-chip motor">Drive Both Motors</strong> with calculated
         durations to make an exact L-shaped path to the goal.</p>
      <p>You can also use <strong class="block-chip drive">Move Forward (pixels)</strong>
         from the Movement section for pixel-perfect control.</p>
    `,
    hint: 'The robot starts at x=205 facing right. The goal is at x=1125. Try: Drive Both Motors (power 5, 1.5s) to go right, then Turn Left 90°, then Drive Both Motors (power 5, 0.8s) up to the goal.',
    commonMistakes: [
      'Duration too long — the robot overshoots and hits the arena wall.',
      'Forgetting to turn — you need to change direction to reach the goal.',
      'Power affects distance — higher power at same duration = farther travel.'
    ],
    starCriteria: { maxTime: 10, maxBlocks: 5 },
    startPosition: { x: 205, y: 955, angleDeg: 0 },
    obstacles: [],
    goalZone: { x: 1125, y: 477, width: 273, height: 273 }
  },
  {
    id: 10,
    title: 'Navigate by Position',
    objective: 'Use the robot\'s x/y position to navigate around an obstacle to the goal.',
    content: `
      <p>Your robot can read its own position with
         <strong class="block-chip sensor">Robot X</strong> and
         <strong class="block-chip sensor">Robot Y</strong> blocks.</p>
      <p>Use <strong class="block-chip control">Repeat Until</strong> with a position check:
         drive upward until <em>Robot Y &lt; 341</em>, then turn and drive right
         until <em>Robot X &gt; 1364</em>.</p>
      <p>This technique lets you navigate precisely — even around obstacles!</p>
    `,
    hint: 'Step 1: Repeat Until (Robot Y < 341) → Drive Both Motors (power 5, 0.1s). Step 2: Turn Right 90°. Step 3: Repeat Until (Robot X > 1364) → Drive Both Motors (power 5, 0.1s).',
    commonMistakes: [
      'Comparing the wrong axis — Y decreases as the robot moves up (0 is the top).',
      'Using ">" instead of "<" for the Y check — since the robot moves up, Y gets smaller.',
      'Drive duration too long inside the loop — use 0.1s so the position check happens frequently.',
      'Forgetting to turn between the two phases — the robot faces up initially, then needs to face right.'
    ],
    starCriteria: { maxTime: 15, maxBlocks: 7 },
    arenaWidth: 1705, arenaHeight: 1295,
    startPosition: { x: 205, y: 1159, angleDeg: -90 },
    obstacles: [
      { x: 614, y: 273, width: 477, height: 55 }
    ],
    goalZone: { x: 1364, y: 136, width: 273, height: 273 }
  }
];
