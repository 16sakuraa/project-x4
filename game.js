import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ---- INIT SCENE ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x220000); // Dark red atmosphere
scene.fog = new THREE.Fog(0x220000, 0, 40);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.y = 1.6; // Average player height

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ---- LIGHTING ----
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(10, 30, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

// Point light attached to player (flashlight)
const flashlight = new THREE.PointLight(0xffaa55, 0.8, 20);
camera.add(flashlight);
scene.add(camera);

// ---- CONTROLS ----
const controls = new PointerLockControls(camera, document.body);

// ---- GUN MODEL ----
const gunGroup = new THREE.Group();

// Main barrel
const barrelGeom = new THREE.BoxGeometry(0.1, 0.1, 0.6);
const barrelMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 });
const barrel = new THREE.Mesh(barrelGeom, barrelMat);
barrel.position.z = -0.15;
barrel.castShadow = true;

// Handle
const handleGeom = new THREE.BoxGeometry(0.1, 0.2, 0.15);
const handleMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
const handle = new THREE.Mesh(handleGeom, handleMat);
handle.position.y = -0.15;
handle.position.z = 0.05;
handle.rotation.x = Math.PI / 8;
handle.castShadow = true;

gunGroup.add(barrel);
gunGroup.add(handle);

// Position locally relative to the camera view
gunGroup.position.set(0.3, -0.3, -0.6);
camera.add(gunGroup);

// ---- SHIELD MODEL ----
const shieldGroup = new THREE.Group();
const shieldGeom = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16);
const shieldMat = new THREE.MeshStandardMaterial({ color: 0x00aaaa, roughness: 0.2 });
const shieldMesh = new THREE.Mesh(shieldGeom, shieldMat);
shieldMesh.rotation.x = Math.PI / 2;
shieldMesh.castShadow = true;
shieldGroup.add(shieldMesh);

// We won't add it to camera until bought
shieldGroup.position.set(-0.4, -0.3, -0.6);
camera.add(shieldGroup);

// ---- INDICATOR ARROW ----
const indicatorGroup = new THREE.Group();
const indicatorGeom = new THREE.ConeGeometry(0.05, 0.2, 8);
const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false }); // Render over walls
const indicatorMesh = new THREE.Mesh(indicatorGeom, indicatorMat);
indicatorMesh.rotation.x = Math.PI / 2; // Face forward along Z axis
indicatorGroup.add(indicatorMesh);
indicatorGroup.position.set(0, 0.35, -1); // Top of screen
indicatorGroup.visible = false;
camera.add(indicatorGroup);

// ---- UI REGISTRY ----
const blockMenu = document.getElementById('instructions');
const scoreDisplay = document.getElementById('score-display');
const scoreHud = document.getElementById('score');
const ammoDisplay = document.getElementById('ammo');
const hitMarker = document.getElementById('hit-marker');

const hpDisplay = document.getElementById('hp');
const shieldUiDisplay = document.getElementById('shield-ui');
const roundDisplay = document.getElementById('round');
const gameOverScreen = document.getElementById('game-over');
const finalScoreDisplay = document.getElementById('final-score');
const upgradeScreen = document.getElementById('upgrade-screen');
const choice1Text = document.getElementById('choice-1-text');
const choice2Text = document.getElementById('choice-2-text');
const choice3Text = document.getElementById('choice-3-text');
const roundTimerDisplay = document.getElementById('round-timer');

let isGameOver = false;
let isUpgradeScreenOpen = false;

// ---- SHIELD STATE ----
let hasShield = true;
let shieldState = 'idle'; // 'idle', 'blocking', 'thrown', 'returning', 'cooldown'
let shieldHP = 3;
let shieldCooldownTimer = 0;
let activeShields = []; // For twin throw logic {mesh, dir, bouncesLeft, hits[]}

let upgrades = { pierce: false, bounce: false, hollow: false, twin: false, stasis: false, infinite: false, haste: 0, blast: false };
let currentChoices = [];
let playerDamageBuffTimer = 0;

document.addEventListener('contextmenu', e => e.preventDefault()); // Prevent normal right click menu

blockMenu.addEventListener('click', () => {
    if (!isGameOver && !isUpgradeScreenOpen) controls.lock();
});

upgradeScreen.addEventListener('click', () => {
    // Cannot bypass upgrade screen by clicking, force them to choose
});

controls.addEventListener('lock', () => {
    blockMenu.style.display = 'none';
});

controls.addEventListener('unlock', () => {
    if (!isGameOver && !isUpgradeScreenOpen) {
        blockMenu.style.display = 'flex';
        scoreDisplay.innerText = `Score: ${score}`;
    }
});

scene.add(controls.getObject());

// ---- MOVEMENT STATE ----
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let canJump = false;

const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

// ---- ROUND TRANSITIONS ----
function startCountdown() {
    isUpgradeScreenOpen = false;
    upgradeScreen.style.display = 'none';
    roundTimerDisplay.style.display = 'block';
    let count = 3;
    roundTimerDisplay.innerText = count;
    playReloadSound();

    const interval = setInterval(() => {
        count--;
        if (count <= 0) {
            clearInterval(interval);
            roundTimerDisplay.style.display = 'none';
            controls.lock(); // Re-lock controls
            startNextRound();
        } else {
            roundTimerDisplay.innerText = count;
            playReloadSound();
        }
    }, 1000);
}

function startNextRound() {
    currentRound++;
    roundDisplay.innerText = `Round: ${currentRound}`;
    
    // Re-scale the maze dynamically
    currentMazeSize += 5;
    buildMaze(currentMazeSize);
    
    // Re-center player smoothly into the newly rebuilt safe zone
    controls.getObject().position.set(0, 1.6, 0);

    for (let i = 0; i < currentRound * 3; i++) {
        spawnEnemy();
    }
}

function selectUpgrade(index) {
    if (index >= currentChoices.length) return;
    const choice = currentChoices[index];
    
    // Handle Consumables or Upgrades
    if (choice.id === 'heal') {
        playerHP = 100;
        hpDisplay.innerText = `HP: ${playerHP}/100`;
    } else if (choice.id === 'ammo_cache') {
        totalAmmo += 50;
        ammoDisplay.innerText = `Ammo: ${ammo}/${maxAmmo} | ${totalAmmo}`;
    } else if (choice.id === 'haste') {
        upgrades.haste += 1;
    } else {
        upgrades[choice.id] = true;
    }
    
    const uiTexts = [choice1Text, choice2Text, choice3Text];
    uiTexts[index].innerText += " - (SELECTED)";
    startCountdown();
}

const onKeyDown = (event) => {
    if (isUpgradeScreenOpen) {
        switch (event.code) {
        case 'Digit1': selectUpgrade(0); break;
        case 'Digit2': selectUpgrade(1); break;
        case 'Digit3': selectUpgrade(2); break;
        }
        return; // Don't process movement keys while picking upgrade
    }

    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = true;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = true;
            break;
        case 'ArrowDown':
        case 'KeyS':
            moveBackward = true;
            break;
        case 'ArrowRight':
        case 'KeyD':
            moveRight = true;
            break;
        case 'Space':
            if (canJump && controls.isLocked) velocity.y += 10;
            canJump = false;
            break;
        case 'KeyR':
            if (controls.isLocked && !upgrades.infinite) reload();
            break;
        case 'KeyE':
            if (controls.isLocked && hasShield && shieldState === 'idle') {
                shieldState = 'thrown';
                shieldGroup.visible = false; // Hide attached model, use free projectiles
                activeShields = [];
                
                const throwDirs = [];
                
                if (upgrades.twin) {
                    camera.getWorldDirection(direction);
                    const eulerL = new THREE.Euler(0, 15 * THREE.MathUtils.DEG2RAD, 0);
                    const eulerR = new THREE.Euler(0, -15 * THREE.MathUtils.DEG2RAD, 0);
                    const dirL = direction.clone().applyEuler(eulerL);
                    const dirR = direction.clone().applyEuler(eulerR);
                    throwDirs.push(dirL, dirR);
                } else {
                    camera.getWorldDirection(direction);
                    throwDirs.push(direction.clone());
                }
                
                for (let dir of throwDirs) {
                    const clone = shieldGroup.clone();
                    scene.add(clone);
                    clone.position.copy(controls.getObject().position);
                    clone.position.y -= 0.2;
                    clone.rotation.set(-Math.PI / 2, 0, 0);
                    clone.visible = true;
                    
                    activeShields.push({
                        mesh: clone,
                        dir: dir,
                        bouncesLeft: (upgrades.bounce ? 1 : 0) + upgrades.haste,
                        hits: []
                    });
                }
            }
            break;
    }
};

document.addEventListener('mousedown', (event) => {
    initAudio(); // Assure audio context is active
    if (controls.isLocked) {
        if (event.button === 0) { // Left click
            shoot();
        } else if (event.button === 2) { // Right click
            if (hasShield && shieldState === 'idle') {
                shieldState = 'blocking';
            }
        }
    }
});

document.addEventListener('mouseup', (event) => {
    if (controls.isLocked) {
        if (event.button === 2) { // Right click releases block
            if (hasShield && shieldState === 'blocking') {
                shieldState = 'idle';
            }
        }
    }
});

const onKeyUp = (event) => {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = false;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = false;
            break;
        case 'ArrowDown':
        case 'KeyS':
            moveBackward = false;
            break;
        case 'ArrowRight':
        case 'KeyD':
            moveRight = false;
            break;
    }
};

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

// ---- MAP GENERATION ----
// Procedurally generates a walled grid with random pillars
function generateMap(width, height) {
    const grid = [];
    for (let i = 0; i < height; i++) {
        const row = [];
        for (let j = 0; j < width; j++) {
            // Border walls
            if (i === 0 || i === height - 1 || j === 0 || j === width - 1) {
                row.push(1);
            } else {
                // Random pillars (15% chance)
                row.push(Math.random() < 0.15 ? 1 : 0);
            }
        }
        grid.push(row);
    }
    
    // Clear out a 5x5 center spawn area so the player isn't trapped
    const cy = Math.floor(height / 2);
    const cx = Math.floor(width / 2);
    for (let i = cy - 2; i <= cy + 2; i++) {
        for (let j = cx - 2; j <= cx + 2; j++) {
            grid[i][j] = 0;
        }
    }
    return grid;
}

const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
const wallGeometry = new THREE.BoxGeometry(2, 4, 2);

const walls = [];
let currentMazeSize = 10;
let mapGrid = [];
const tileSize = 2; // Size of each block

function buildMaze(size) {
    // Clear old walls
    for (const wall of walls) {
        scene.remove(wall);
        
        // Clean up geometry and material memory
        wall.geometry.dispose();
        // Since we share one material we don't dispose it here, just remove the mesh
    }
    walls.length = 0;
    
    // 1 = Wall, 0 = Floor
    mapGrid = generateMap(size, size);
    
    for (let i = 0; i < mapGrid.length; i++) {
        for (let j = 0; j < mapGrid[i].length; j++) {
            if (mapGrid[i][j] === 1) {
                const wall = new THREE.Mesh(wallGeometry, wallMaterial);
                // Center the maze on 0,0
                wall.position.x = (j * tileSize) - (mapGrid[0].length * tileSize / 2);
                wall.position.z = (i * tileSize) - (mapGrid.length * tileSize / 2);
                wall.position.y = 2; // half height
                wall.castShadow = true;
                wall.receiveShadow = true;
                scene.add(wall);
                walls.push(wall);
            }
        }
    }
}

// Generate the initial Round 1 arena
buildMaze(currentMazeSize);

// Floor
const floorGeometry = new THREE.PlaneGeometry(200, 200);
// create a checkerboard or concrete style
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x551111, roughness: 1 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Spawn point
controls.getObject().position.set(0, 1.6, 5); // In an open area roughly bounded by our map constraints

// ---- AUDIO SYSTEM ----
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playShootSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function playHitSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.05);
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function playReloadSound() {
    if (!audioCtx) return;
    const playClick = (timeOffset) => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, audioCtx.currentTime + timeOffset);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + timeOffset + 0.05);
        gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime + timeOffset);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + timeOffset + 0.05);
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + timeOffset);
        osc.stop(audioCtx.currentTime + timeOffset + 0.05);
    };
    playClick(0);
    playClick(0.4);
}

function playParrySound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, audioCtx.currentTime); 
    osc.frequency.exponentialRampToValueAtTime(3000, audioCtx.currentTime + 0.1); // High pitched ping
    gainNode.gain.setValueAtTime(0.6, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

// ---- HEALTH PACKS ----
const healthPacks = [];
const healthPackGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const healthPackMaterial = new THREE.MeshStandardMaterial({ color: 0xffaaaa, emissive: 0xffffff, emissiveIntensity: 0.5 });

const ammoPacks = [];
const ammoPackGeometry = new THREE.BoxGeometry(0.5, 0.3, 0.5);
const ammoPackMaterial = new THREE.MeshStandardMaterial({ color: 0x4444ff, emissive: 0x8888ff, emissiveIntensity: 0.5 });

// ---- ENEMIES ----
const enemies = [];
const enemyGeometry = new THREE.BoxGeometry(1.2, 2.0, 1.2);
const enemyMaterialTemplate = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 });
const enemyProjectiles = [];
const projGeometry = new THREE.SphereGeometry(0.3, 8, 8);
const projMaterial = new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0xff00ff, emissiveIntensity: 0.8 });

function spawnEnemy() {
    let i = Math.floor(Math.random() * mapGrid.length);
    let j = Math.floor(Math.random() * mapGrid[0].length);

    // Naively avoid spawning on walls or in center
    while (mapGrid[i][j] === 1 || (i > mapGrid.length/2 - 3 && i < mapGrid.length/2 + 3 && j > mapGrid[0].length/2 - 3 && j < mapGrid[0].length/2 + 3)) {
        i = Math.floor(Math.random() * mapGrid.length);
        j = Math.floor(Math.random() * mapGrid[0].length);
    }

    let hp = 1;
    let color = 0xff0000; // Red (Basic)
    let armored = false;
    let type = 'basic';
    let scale = 1.0;

    if (currentRound > 2) {
        const rand = Math.random();
        if (rand > 0.8) {
            type = 'brute';
            hp = 50;
            color = 0x4a2a18; // Brown
            scale = 1.5;
        } else if (rand > 0.6) {
            type = 'artillery';
            hp = 3;
            color = 0xff00ff; // Magenta
        } else if (rand > 0.4) {
            type = 'ambusher';
            hp = 2;
            color = 0x800080; // Purple
        } else if (rand > 0.2) {
            type = 'basic';
            hp = 2;
            color = 0xffff00; // Yellow (Armored Basic)
            armored = true;
        }
    } else if (currentRound > 1) {
        const rand = Math.random();
        if (rand > 0.6) {
            type = 'ambusher';
            hp = 2;
            color = 0x800080; // Purple
        } else if (rand > 0.3) {
            type = 'artillery';
            hp = 2;
            color = 0xff00ff; // Magenta
        }
    }

    const mat = enemyMaterialTemplate.clone();
    mat.color.setHex(color);

    const enemy = new THREE.Mesh(enemyGeometry, mat);
    enemy.scale.setScalar(scale);
    enemy.position.x = (j * tileSize) - (mapGrid[0].length * tileSize / 2);
    enemy.position.y = scale; // floating slightly based on scale
    enemy.position.z = (i * tileSize) - (mapGrid.length * tileSize / 2);
    enemy.castShadow = true;
    enemy.receiveShadow = true;

    // FSM State and Archetype data
    enemy.userData = { 
        type: type,
        state: 'chase',
        offset: Math.random() * Math.PI * 2, 
        hp: hp, 
        armored: armored, 
        slowTimer: 0,
        staggerGauge: 0,
        staggerTimer: 0,
        attackCooldown: 0,
        baseColor: color,
        strafeDir: Math.random() > 0.5 ? 1 : -1
    };

    scene.add(enemy);
    enemies.push(enemy);
}

let playerHP = 100;
let currentRound = 1;

function spawnWave() {
    const numEnemies = currentRound * 5;
    for (let i = 0; i < numEnemies; i++) {
        spawnEnemy();
    }
}

// Spawn initial batch
spawnWave();

// ---- WEAPON STATE & SHOOTING MECHANICS ----
let score = 0;
let totalAmmo = 30;
let ammo = 10;
let maxAmmo = 10;
let weaponUpgraded = false;
let isReloading = false;
let reloadTimer = 0;

function reload() {
    if (isReloading || ammo === maxAmmo || totalAmmo <= 0) return;
    isReloading = true;
    ammoDisplay.innerText = "Reloading...";
    playReloadSound();
}

function damageEnemy(enemy, amount, isShieldHit) {
    if (enemy.userData.type === 'brute') {
        if (isShieldHit) {
            enemy.userData.staggerGauge++;
            if (enemy.userData.staggerGauge >= 3) {
                enemy.userData.state = 'staggered';
                enemy.userData.staggerTimer = 3.0; // 3 second stun window
                enemy.material.color.setHex(0xffffff); // Flash White!
                enemy.material.emissive.setHex(0xaaaaaa);
                playHitSound(); // Critical shatter sound
                return;
            }
            playReloadSound(); // Heavy clank, no damage
            return;
        } else {
            // Gun damage to a Brute
            if (enemy.userData.state === 'staggered') {
                amount = 15; // Critical Damage!
            } else {
                amount = 1; // Bullet sponge normally
            }
        }
    } else {
        if (enemy.userData.armored) {
            if (!isShieldHit) {
                // Deflected
                playReloadSound(); // Use mechanical clip sound as an armor block sound
                return;
            } else {
                // Armor Break!
                enemy.userData.armored = false;
                enemy.material.color.setHex(0x00ff00); // Expose green underlying health
                playHitSound();
                return; // Shield strips armor but deals no actual HP damage this hit
            }
        }
    }
    
    if (isShieldHit && upgrades.stasis) {
        enemy.userData.slowTimer = 3.0;
        enemy.material.emissive.setHex(0x2244aa); // Visual slow feedback
        setTimeout(() => enemy.material.emissive.setHex(0x333333), 3000);
    }

    enemy.userData.hp -= amount;
    showHitMarker();
    playHitSound();

    if (enemy.userData.hp <= 0) {
        if (isShieldHit && enemy.userData.type !== 'brute') {
            // Guaranteed Ammo Drop via Shield
            const pack = new THREE.Mesh(ammoPackGeometry, ammoPackMaterial);
            pack.position.copy(enemy.position);
            pack.position.y = 0.15; // Sit flat on floor
            pack.castShadow = true;
            scene.add(pack);
            ammoPacks.push(pack);
        } else {
            // Guaranteed Health Drop via Gun
            const pack = new THREE.Mesh(healthPackGeometry, healthPackMaterial);
            pack.position.copy(enemy.position);
            pack.position.y = 0.2;
            pack.castShadow = true;
            scene.add(pack);
            healthPacks.push(pack);
        }

        scene.remove(enemy);
        enemies.splice(enemies.indexOf(enemy), 1);
        score += 10;
        scoreHud.innerText = `Score: ${score}`;
        
        // Round End Trigger
        if (enemies.length === 0 && !isGameOver) {
            generateUpgradeChoices();
            isUpgradeScreenOpen = true;
            controls.unlock();
            upgradeScreen.style.display = 'flex';
            
            // Wipe remnants
            for (let p of enemyProjectiles) {
                scene.remove(p.mesh);
            }
            enemyProjectiles.length = 0;
        }
    } else {
        // Adjust color based on remaining HP (excluding brute)
        if (enemy.userData.type !== 'brute') {
            if (enemy.userData.hp === 2) {
                enemy.material.color.setHex(0x00ff00); // Green
            } else if (enemy.userData.hp === 1 && !enemy.userData.armored) {
                enemy.material.color.setHex(0xff0000); // Red
            }
        }
    }
}

function generateUpgradeChoices() {
    const allUpgrades = [
        { id: 'pierce', name: 'Piercing Rounds' },
        { id: 'bounce', name: 'Shield Bounce' },
        { id: 'hollow', name: 'Hollow Point' },
        { id: 'twin', name: 'Twin Throw' },
        { id: 'stasis', name: 'Stasis Coating' },
        { id: 'blast', name: 'Blast Shield' }
    ];
    let pool = allUpgrades.filter(u => !upgrades[u.id]);
    
    // Stackable upgrades are always available
    pool.push({ id: 'haste', name: `Shield Haste (Lvl Level ${upgrades.haste + 1})` });
    
    if (!upgrades.infinite && Math.random() < 0.05) {
        pool.push({ id: 'infinite', name: 'Infinite Ammo (LEGENDARY)' });
    }
    
    // Shuffle pool
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    
    currentChoices = pool.slice(0, 3);
    
    // Fill remaining with consumables
    while (currentChoices.length < 3) {
        if (!currentChoices.find(c => c.id === 'heal')) currentChoices.push({ id: 'heal', name: 'Full Heal (+100 HP)' });
        else currentChoices.push({ id: 'ammo_cache', name: 'Ammo Cache (+50)' });
    }
    
    choice1Text.innerText = `[ 1 ] ${currentChoices[0].name}`;
    choice2Text.innerText = `[ 2 ] ${currentChoices[1].name}`;
    choice3Text.innerText = `[ 3 ] ${currentChoices[2].name}`;
}

const raycaster = new THREE.Raycaster();

function shoot() {
    if (isReloading || (ammo <= 0 && !upgrades.infinite)) return;

    // Deduct ammo
    if (!upgrades.infinite) {
        ammo--;
        ammoDisplay.innerText = `Ammo: ${ammo}/${maxAmmo} | ${totalAmmo}`;
    } else {
        ammoDisplay.innerText = `Ammo: ∞`;
    }

    // Weapon kickback hook
    gunGroup.position.z += 0.1;
    gunGroup.rotation.x += 0.15;

    // Flash effect
    scene.background = new THREE.Color(0x550000);
    setTimeout(() => scene.background = new THREE.Color(0x220000), 50);

    // Raycast from the center of camera
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects([...walls, ...enemies]);

    playShootSound();

    if (intersects.length > 0) {
        const damage = (upgrades.hollow ? 2 : 1) * (playerDamageBuffTimer > 0 ? 2 : 1);
        const hitSet = new Set();
        
        for (let k = 0; k < intersects.length; k++) {
            const hitObj = intersects[k].object;
            
            if (walls.includes(hitObj)) break; // Bullet physically stops at walls

            if (enemies.includes(hitObj) && !hitSet.has(hitObj)) {
                hitSet.add(hitObj);
                damageEnemy(hitObj, damage, false);
                
                if (!upgrades.pierce) break; // Bullet normally stops at first enemy body
            }
        }
    }

    // Auto reload if emptied naturally
    if (ammo === 0 && !upgrades.infinite) {
        reload();
    }
}

function showHitMarker() {
    hitMarker.style.display = 'block';
    setTimeout(() => hitMarker.style.display = 'none', 100);
}

// ---- COLLISION LOGIC ----
function checkCollision(pos) {
    const pX = pos.x;
    const pZ = pos.z;
    const playerRadius = 0.5; // Collision radius

    for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        const wX = wall.position.x;
        const wZ = wall.position.z;
        const hW = tileSize / 2; // half width

        // Simple AABB overlap
        if (
            pX + playerRadius > wX - hW &&
            pX - playerRadius < wX + hW &&
            pZ + playerRadius > wZ - hW &&
            pZ - playerRadius < wZ + hW
        ) {
            return true;
        }
    }
    return false;
}

// ---- MAIN LOOP ----
let prevTime = performance.now();
let lastHitTime = 0;

function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();

    if (controls.isLocked === true && !isGameOver) {
        const delta = (time - prevTime) / 1000;
        const controlObj = controls.getObject();

        if (playerDamageBuffTimer > 0) {
            playerDamageBuffTimer -= delta;
        }

        // Enemy chasing logic & animations
        const playerPos = controlObj.position.clone();
        let baseSpeed = 2.0 + (currentRound * 0.5); // Enemies get faster

        // Resolve Enemy Projectiles Loop
        for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
            const proj = enemyProjectiles[i];
            proj.mesh.position.addScaledVector(proj.dir, 15 * delta); // Slow 15 units p/s
            
            // Collision with Map or Player
            if (checkCollision(proj.mesh.position)) {
                scene.remove(proj.mesh);
                enemyProjectiles.splice(i, 1);
            } else if (proj.mesh.position.distanceTo(playerPos) < 1.0) {
                if (hasShield && shieldState === 'blocking') {
                    // PARRY TRIGGERED!
                    scene.remove(proj.mesh);
                    enemyProjectiles.splice(i, 1);
                    playParrySound();
                    
                    ammo = maxAmmo;
                    ammoDisplay.innerText = `Ammo: ${upgrades.infinite ? '∞' : ammo + '/' + maxAmmo + ' | ' + totalAmmo}`;
                    playerDamageBuffTimer = 5.0; // 5 seconds of DOUBLE damage
                    
                    scene.background = new THREE.Color(0x00aaff); // Bright Cyan
                    setTimeout(() => scene.background = new THREE.Color(0x220000), 100);

                    // Blast Shield trigger
                    if (upgrades.blast) {
                        enemies.forEach(ae => {
                            if (ae.position.distanceTo(playerPos) < 15) {
                                ae.userData.state = 'staggered';
                                ae.userData.staggerTimer = 3.0;
                                ae.material.color.setHex(0xffffff); // Flash White!
                                ae.material.emissive.setHex(0xaaaaaa);
                            }
                        });
                    }
                } else {
                    // Hit Player!
                    scene.remove(proj.mesh);
                    enemyProjectiles.splice(i, 1);
                    playerHP -= 10;
                    hpDisplay.innerText = `HP: ${playerHP}/100`;
                    scene.background = new THREE.Color(0xaa0000);
                    setTimeout(() => scene.background = new THREE.Color(0x220000), 100);
                    playHitSound();

                    if (playerHP <= 0) {
                        playerHP = 0;
                        hpDisplay.innerText = `HP: 0/100`;
                        isGameOver = true;
                        controls.unlock();
                        gameOverScreen.style.display = 'flex';
                        finalScoreDisplay.innerText = `Final Score: ${score} - Reached Round: ${currentRound}`;
                    }
                }
            }
        }

        enemies.forEach(e => {
            // State Independent LookAt
            const targetPos = playerPos.clone();
            targetPos.y = e.position.y;
            e.lookAt(targetPos);

            const dist = e.position.distanceTo(playerPos);
            const toPlayerVec = new THREE.Vector3().subVectors(targetPos, e.position).normalize();
            
            // ---- FSM LOGIC DELEGATION ----
            if (e.userData.type === 'brute' && e.userData.state === 'staggered') {
                e.userData.staggerTimer -= delta;
                if (e.userData.staggerTimer <= 0) {
                    e.userData.state = 'chase';
                    e.userData.staggerGauge = 0;
                    e.material.color.setHex(e.userData.baseColor); // Revert brown
                    e.material.emissive.setHex(0x333333);
                }
                return; // Staggered brutes do not move or attack
            } else if (e.userData.type === 'artillery') {
                if (dist < 10) e.userData.state = 'flee';
                else if (dist > 18) e.userData.state = 'chase';
                else e.userData.state = 'attack';
            } else if (e.userData.type === 'ambusher') {
                e.userData.state = 'chase'; // default
                // Player looking at it Ray Check (Dot product)
                const playerLookDir = new THREE.Vector3();
                camera.getWorldDirection(playerLookDir);
                const enemyDir = new THREE.Vector3().subVectors(e.position, playerPos).normalize();
                const dot = playerLookDir.dot(enemyDir);
                
                // If closely in view and far enough to maneuver, strafe!
                if (dot > 0.85 && dist > 5) {
                    e.userData.state = 'strafe';
                }
            } else {
                e.userData.state = 'chase'; // Basic & Brute
            }
            
            // FSM Actions
            let moveDir = new THREE.Vector3();
            let applySpeed = baseSpeed;
            
            if (e.userData.type === 'ambusher') applySpeed *= 1.8; // Fast flankers
            if (e.userData.type === 'brute') applySpeed *= 0.6; // Slow lumbering tanks

            if (e.userData.slowTimer > 0) {
                applySpeed *= 0.5; // Stasis applied
                e.userData.slowTimer -= delta;
            }

            if (e.userData.state === 'chase') {
                moveDir.copy(toPlayerVec);
            } else if (e.userData.state === 'flee') {
                moveDir.copy(toPlayerVec).negate(); // Move directly backwards
            } else if (e.userData.state === 'strafe') {
                // Strafe perpendicular to player look vector
                moveDir.set(-toPlayerVec.z * e.userData.strafeDir, 0, toPlayerVec.x * e.userData.strafeDir).normalize();
            } else if (e.userData.state === 'attack') {
                e.userData.attackCooldown -= delta;
                if (e.userData.attackCooldown <= 0) {
                    e.userData.attackCooldown = 3.0; // 3 seconds per barrage
                    // Spawn Projectile
                    const proj = new THREE.Mesh(projGeometry, projMaterial);
                    proj.position.copy(e.position);
                    proj.position.y += 0.5; // Eye level loosely
                    scene.add(proj);
                    enemyProjectiles.push({
                        mesh: proj,
                        dir: toPlayerVec.clone()
                    });
                }
                // Do not move while strictly in Artillery attack state
                applySpeed = 0; 
            }

            // Attempt movement components independently (Sliding Collision)
            const oldEX = e.position.x;
            const oldEZ = e.position.z;

            e.position.x += moveDir.x * applySpeed * delta;
            if (checkCollision(e.position)) {
                e.position.x = oldEX; // Blocked along X
            }

            e.position.z += moveDir.z * applySpeed * delta;
            if (checkCollision(e.position)) {
                e.position.z = oldEZ; // Blocked along Z
            }

            // Simple bobbing effect
            e.position.y = 1 + Math.sin(time / 400 + e.userData.offset) * 0.3;

            // Damage collision check (Melee Hit)
            if (e.userData.type === 'artillery') return; // Artillery does not deal touch damage
            
            // Prevention of clipping: hide the enemy if it gets right up in your face
            e.visible = dist > 1.25;
            
            if (dist < 1.2 && time - lastHitTime > 1000) {
                lastHitTime = time;

                if (shieldState === 'blocking') {
                    // Blocked by shield
                    shieldHP--;
                    shieldUiDisplay.innerText = `Shield: ${shieldHP}/3`;

                    // Knockback physics
                    velocity.x += moveDir.x * 20;
                    velocity.z += moveDir.z * 20;

                    if (shieldHP <= 0) {
                        shieldState = 'cooldown';
                        shieldCooldownTimer = 3.0; // 3 seconds
                        camera.remove(shieldGroup);
                        shieldUiDisplay.innerText = `Shield: Broken (Cooldown)`;
                        playHitSound(); // Could use a metal breaking sound, but this is fine
                    }
                } else {
                    // Take Damage
                    playerHP -= 20;
                    hpDisplay.innerText = `HP: ${playerHP}/100`;

                    // Hit effect flash
                    scene.background = new THREE.Color(0xaa0000);
                    setTimeout(() => scene.background = new THREE.Color(0x220000), 100);

                    // Knockback physics
                    velocity.x += moveDir.x * 30; // Push X
                    velocity.z += moveDir.z * 30; // Push Z
                    velocity.y += 5; // Slight pop up
                    canJump = false;

                    if (playerHP <= 0) {
                        playerHP = 0;
                        hpDisplay.innerText = `HP: 0/100`;
                        isGameOver = true;
                        controls.unlock();
                        gameOverScreen.style.display = 'flex';
                        finalScoreDisplay.innerText = `Final Score: ${score} - Reached Round: ${currentRound}`;
                    }
                }
            }
        });

        // Final Enemies Radar Indicator
        if (enemies.length > 0 && enemies.length < 3) {
            indicatorGroup.visible = true;
            let closestEnemy = enemies[0];
            let minDist = playerPos.distanceTo(closestEnemy.position);
            for (let i = 1; i < enemies.length; i++) {
                const eDist = playerPos.distanceTo(enemies[i].position);
                if (eDist < minDist) {
                    minDist = eDist;
                    closestEnemy = enemies[i];
                }
            }
            // Orbits the group perfectly toward the target in world space coordinates
            indicatorGroup.lookAt(closestEnemy.position);
        } else {
            indicatorGroup.visible = false;
        }

        // Health Pack Logic
        for (let i = healthPacks.length - 1; i >= 0; i--) {
            const pack = healthPacks[i];
            pack.rotation.y += 2 * delta; // Spin pack
            
            if (pack.position.distanceTo(playerPos) < 1.5) {
                // Collect
                playerHP = Math.min(100, playerHP + 5);
                hpDisplay.innerText = `HP: ${playerHP}/100`;
                scene.remove(pack);
                healthPacks.splice(i, 1);
                
                // Heal confirmation flash
                scene.background = new THREE.Color(0x003300);
                setTimeout(() => scene.background = new THREE.Color(0x220000), 100);
                playReloadSound();
            }
        }

        // Ammo Pack Logic
        for (let i = ammoPacks.length - 1; i >= 0; i--) {
            const pack = ammoPacks[i];
            pack.rotation.y += 2 * delta; // Spin pack
            
            if (pack.position.distanceTo(playerPos) < 1.5) {
                // Collect
                totalAmmo += 15;
                ammoDisplay.innerText = `Ammo: ${ammo}/${maxAmmo} | ${totalAmmo}`;
                scene.remove(pack);
                ammoPacks.splice(i, 1);
                
                // Ammo confirmation flash
                scene.background = new THREE.Color(0x000055);
                setTimeout(() => scene.background = new THREE.Color(0x220000), 100);
                playReloadSound();
            }
        }

        // Shield Logic & Animations
        if (hasShield) {
            if (shieldState === 'idle') {
                shieldGroup.position.lerp(new THREE.Vector3(-0.4, -0.3, -0.6), 0.2);
                shieldGroup.rotation.x = 0;
                shieldGroup.rotation.y = Math.PI / 8; // Slightly angled in hand
            } else if (shieldState === 'blocking') {
                shieldGroup.position.lerp(new THREE.Vector3(0, -0.2, -0.5), 0.2); // Center-low of screen
                shieldGroup.rotation.x = Math.PI / 8; // Leaning away defensively
                shieldGroup.rotation.y = 0;
            } else if (shieldState === 'cooldown') {
                shieldCooldownTimer -= delta;
                if (shieldCooldownTimer <= 0) {
                    shieldHP = 3;
                    shieldState = 'idle';
                    camera.add(shieldGroup);
                    shieldUiDisplay.innerText = `Shield: 3/3`;
                } else {
                    shieldUiDisplay.innerText = `Shield: Cooldown (${shieldCooldownTimer.toFixed(1)}s)`;
                }
            } else if (shieldState === 'thrown' || shieldState === 'returning') {
                const moveDist = 40 * (1 + (0.4 * upgrades.haste)) * delta;
                
                // Track remaining returning shields
                let livingShieldsCount = activeShields.length;

                for (let i = 0; i < activeShields.length; i++) {
                    const currentShield = activeShields[i];
                    if (!currentShield) continue;

                    if (shieldState === 'thrown') {
                        // Penetrating Damage
                        enemies.forEach(e => {
                            if (e.position.distanceTo(currentShield.mesh.position) < 1.5 && !currentShield.hits.includes(e)) {
                                currentShield.hits.push(e);
                                damageEnemy(e, 2, true); // Shield deals 2 base damage AND breaks armor
                            }
                        });

                        // Ricochet Physics & Collision
                        const oldX = currentShield.mesh.position.x;
                        const oldZ = currentShield.mesh.position.z;
                        
                        currentShield.mesh.position.x += currentShield.dir.x * moveDist;
                        const hitX = checkCollision(currentShield.mesh.position);
                        currentShield.mesh.position.x = oldX;

                        currentShield.mesh.position.z += currentShield.dir.z * moveDist;
                        const hitZ = checkCollision(currentShield.mesh.position);
                        currentShield.mesh.position.z = oldZ;

                        if (hitX || hitZ) {
                            if (currentShield.bouncesLeft > 0) {
                                currentShield.bouncesLeft--;
                                if (hitX) currentShield.dir.x *= -1;
                                if (hitZ) currentShield.dir.z *= -1;
                                playReloadSound(); // Metallic clink for bounce!
                                // Move safely along new vector this frame
                                currentShield.mesh.position.x += currentShield.dir.x * moveDist;
                                currentShield.mesh.position.z += currentShield.dir.z * moveDist;
                            } else {
                                shieldState = 'returning'; // Turn ALL shields around
                            }
                        } else {
                            // Normal movement
                            currentShield.mesh.position.x += currentShield.dir.x * moveDist;
                            currentShield.mesh.position.z += currentShield.dir.z * moveDist;
                        }
                    } else if (shieldState === 'returning') {
                        const returnDir = new THREE.Vector3().subVectors(playerPos, currentShield.mesh.position).normalize();
                        currentShield.mesh.position.addScaledVector(returnDir, 50 * (1 + (0.4 * upgrades.haste)) * delta); // Fly back faster
                        
                        if (currentShield.mesh.position.distanceTo(playerPos) < 1.0) {
                            scene.remove(currentShield.mesh);
                            activeShields[i] = null;
                            livingShieldsCount--;
                        }
                    }
                    
                    if (currentShield) {
                        currentShield.mesh.rotation.set(-Math.PI / 2, 0, currentShield.mesh.rotation.z + (15 * delta));
                    }
                }

                // If all shields returned
                activeShields = activeShields.filter(s => s !== null);
                if (activeShields.length === 0 && shieldState === 'returning') {
                    shieldState = 'idle';
                    shieldGroup.visible = true; // Unhide original model
                }
            } 
        }

        // Weapon Animations
        if (!isReloading) {
            // Sway/bobbing when walking
            if (moveForward || moveBackward || moveLeft || moveRight) {
                gunGroup.position.y = -0.3 + Math.sin(time / 150) * 0.015;
                gunGroup.position.x = 0.3 + Math.cos(time / 150) * 0.015;
            } else {
                gunGroup.position.y = THREE.MathUtils.lerp(gunGroup.position.y, -0.3, 0.1);
                gunGroup.position.x = THREE.MathUtils.lerp(gunGroup.position.x, 0.3, 0.1);
            }

            // Return from recoil
            gunGroup.position.z = THREE.MathUtils.lerp(gunGroup.position.z, -0.6, 0.1);
            gunGroup.rotation.x = THREE.MathUtils.lerp(gunGroup.rotation.x, 0, 0.1);
        } else {
            // Reload animation interpolation
            const reloadSpeed = weaponUpgraded ? 1.5 : 1.0; // Faster reload with upgrade
            reloadTimer += delta * reloadSpeed;

            if (reloadTimer < 0.4) {
                // Tilt down and back
                gunGroup.rotation.x = THREE.MathUtils.lerp(gunGroup.rotation.x, -Math.PI / 3, 0.15);
                gunGroup.position.y = THREE.MathUtils.lerp(gunGroup.position.y, -0.5, 0.15);
            } else if (reloadTimer < 0.9) {
                // Tilt back up
                gunGroup.rotation.x = THREE.MathUtils.lerp(gunGroup.rotation.x, 0, 0.15);
                gunGroup.position.y = THREE.MathUtils.lerp(gunGroup.position.y, -0.3, 0.15);
            } else {
                // Done reloading
                isReloading = false;
                reloadTimer = 0;

                // Discard logic - pull completely fresh mag from total ammo
                const bulletsToTake = Math.min(maxAmmo, totalAmmo);
                totalAmmo -= bulletsToTake;
                ammo = bulletsToTake;

                ammoDisplay.innerText = `Ammo: ${ammo}/${maxAmmo} | ${totalAmmo}`;
            }
        }

        // Apply friction/decay to movement speed
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        velocity.y -= 30.0 * delta; // Gravity

        // Determine intended input direction
        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        // Speed multiplier
        const speed = 40.0;

        if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

        // Slidable movement logic
        const oldX = controlObj.position.x;
        const oldZ = controlObj.position.z;

        // Calculate raw intended move
        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        const newX = controlObj.position.x;
        const newZ = controlObj.position.z;

        // Return to old before validation
        controlObj.position.x = oldX;
        controlObj.position.z = oldZ;

        // Attempt X move
        controlObj.position.x = newX;
        if (checkCollision(controlObj.position)) {
            controlObj.position.x = oldX; // Blocked, reset X
            velocity.x = 0;
        }

        // Attempt Z move
        controlObj.position.z = newZ;
        if (checkCollision(controlObj.position)) {
            controlObj.position.z = oldZ; // Blocked, reset Z
            velocity.z = 0; // Wait, moveForward is Z in local coordinates, but here velocity.z corresponds to the forward component across the map depending on look angle. Actually, resetting velocity.z here might be slightly off due to rotation but works fine for simple stop.
        }

        // Apply Y movement (gravity/jumping)
        controlObj.position.y += (velocity.y * delta);

        if (controlObj.position.y < 1.6) {
            velocity.y = 0;
            controlObj.position.y = 1.6;
            canJump = true;
        }
    }

    prevTime = time;
    renderer.render(scene, camera);
}

animate();

// Handle resizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
