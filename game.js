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
const marketScreen = document.getElementById('market-screen');
const upgradeText = document.getElementById('upgrade-text');
const shieldBuyText = document.getElementById('shield-buy-text');

let isGameOver = false;
let isMarketOpen = false;

// ---- SHIELD STATE ----
let hasShield = true;
let shieldState = 'idle'; // 'idle', 'blocking', 'thrown', 'returning', 'cooldown'
let shieldHP = 3;
let shieldCooldownTimer = 0;
let shieldThrowDir = new THREE.Vector3();
let shieldHits = [];
let shieldBouncesUnlocked = false;
let shieldBouncesLeft = 0;

document.addEventListener('contextmenu', e => e.preventDefault()); // Prevent normal right click menu

blockMenu.addEventListener('click', () => {
    if (!isGameOver && !isMarketOpen) controls.lock();
});

marketScreen.addEventListener('click', () => {
    // Clicking the market box locks controls and closes market
    if (!isGameOver) controls.lock();
});

controls.addEventListener('lock', () => {
    blockMenu.style.display = 'none';
    marketScreen.style.display = 'none';
    isMarketOpen = false;
});

controls.addEventListener('unlock', () => {
    if (!isGameOver && !isMarketOpen) {
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

const onKeyDown = (event) => {
    if (isMarketOpen) {
        if (event.code === 'Digit1') {
            if (score >= 50) {
                score -= 50;
                totalAmmo += 30;
                scoreHud.innerText = `Score: ${score}`;
                ammoDisplay.innerText = `Ammo: ${ammo}/${maxAmmo} | ${totalAmmo}`;
            }
        } else if (event.code === 'Digit2') {
            if (score >= 250 && !weaponUpgraded) {
                score -= 250;
                weaponUpgraded = true;
                maxAmmo = 20;
                ammo = 20; // Free refill on upgrade
                barrelMat.color.setHex(0x2244aa); // Change gun color to blue
                upgradeText.innerText = "[ 2 ] Weapon Upgrade - MAXED OUT";
                scoreHud.innerText = `Score: ${score}`;
                ammoDisplay.innerText = `Ammo: ${ammo}/${maxAmmo} | ${totalAmmo}`;
            }
        } else if (event.code === 'Digit3') {
            if (score >= 300 && !shieldBouncesUnlocked) {
                score -= 300;
                shieldBouncesUnlocked = true;
                shieldBuyText.innerText = "[ 3 ] Shield Bounce - PURCHASED";
                scoreHud.innerText = `Score: ${score}`;
            }
        }
        return; // Don't process movement keys while in market
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
            if (controls.isLocked) reload();
            break;
        case 'KeyB':
            if (!isGameOver && controls.isLocked) {
                isMarketOpen = true;
                marketScreen.style.display = 'flex';
                controls.unlock();
            }
            break;
        case 'KeyE':
            if (controls.isLocked && hasShield && shieldState === 'idle') {
                shieldState = 'thrown';
                shieldHits = [];
                shieldBouncesLeft = shieldBouncesUnlocked ? 1 : 0;
                
                // Move from camera local to scene world
                camera.remove(shieldGroup);
                scene.add(shieldGroup);
                shieldGroup.position.copy(controls.getObject().position);
                shieldGroup.position.y -= 0.2; // Start throw slightly below eye level
                shieldGroup.rotation.set(-Math.PI / 2, 0, 0); // Flat like a frisbee
                camera.getWorldDirection(shieldThrowDir);
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
// 1 = Wall, 0 = Floor
const mapGrid = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1],
    [1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1],
    [1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1],
    [1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1],
    [1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
];

const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
const wallGeometry = new THREE.BoxGeometry(2, 4, 2);
const walls = [];
const tileSize = 2; // Size of each block

for (let i = 0; i < mapGrid.length; i++) {
    for (let j = 0; j < mapGrid[i].length; j++) {
        if (mapGrid[i][j] === 1) {
            const wall = new THREE.Mesh(wallGeometry, wallMaterial);
            // Center the map at (0,0) roughly
            wall.position.x = (j * tileSize) - (mapGrid[0].length * tileSize / 2);
            wall.position.y = 2; // half height
            wall.position.z = (i * tileSize) - (mapGrid.length * tileSize / 2);
            wall.castShadow = true;
            wall.receiveShadow = true;
            scene.add(wall);
            walls.push(wall);
        }
    }
}

// Floor
const floorGeometry = new THREE.PlaneGeometry(100, 100);
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

function spawnEnemy() {
    let i = Math.floor(Math.random() * mapGrid.length);
    let j = Math.floor(Math.random() * mapGrid[0].length);

    // Naively avoid spawning on walls
    while (mapGrid[i][j] === 1) {
        i = Math.floor(Math.random() * mapGrid.length);
        j = Math.floor(Math.random() * mapGrid[0].length);
    }

    let hp = 1;
    let color = 0xff0000; // Red
    let armored = false;

    if (currentRound > 2) {
        const rand = Math.random();
        if (rand > 0.8) {
            hp = 2;
            color = 0xffff00; // Yellow (Armored)
            armored = true;
        } else if (rand > 0.6) {
            hp = 3;
            color = 0x0000ff; // Blue
        } else if (rand > 0.4) {
            hp = 2;
            color = 0x00ff00; // Green
        }
    } else if (currentRound > 1) {
        const rand = Math.random();
        if (rand > 0.8) {
            hp = 3;
            color = 0x0000ff; // Blue
        } else if (rand > 0.4) {
            hp = 2;
            color = 0x00ff00; // Green
        }
    }

    const mat = enemyMaterialTemplate.clone();
    mat.color.setHex(color);

    const enemy = new THREE.Mesh(enemyGeometry, mat);
    enemy.position.x = (j * tileSize) - (mapGrid[0].length * tileSize / 2);
    enemy.position.y = 1; // floating slightly
    enemy.position.z = (i * tileSize) - (mapGrid.length * tileSize / 2);
    enemy.castShadow = true;
    enemy.receiveShadow = true;

    // Enemy data for simple animations and hp
    enemy.userData = { offset: Math.random() * Math.PI * 2, hp: hp, armored: armored };

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

    enemy.userData.hp -= amount;
    showHitMarker();
    playHitSound();

    if (enemy.userData.hp <= 0) {
        if (isShieldHit) {
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

        if (enemies.length === 0) {
            currentRound++;
            roundDisplay.innerText = `Round: ${currentRound}`;
            spawnWave();
        }
    } else {
        // Adjust color based on remaining HP
        if (enemy.userData.hp === 2) {
            enemy.material.color.setHex(0x00ff00); // Green
        } else if (enemy.userData.hp === 1) {
            enemy.material.color.setHex(0xff0000); // Red
        }
    }
}

const raycaster = new THREE.Raycaster();

function shoot() {
    if (isReloading || ammo <= 0) return;

    // Deduct ammo
    ammo--;
    ammoDisplay.innerText = `Ammo: ${ammo}/${maxAmmo} | ${totalAmmo}`;

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
        const firstHit = intersects[0];
        if (enemies.includes(firstHit.object)) {
            const hitEnemy = firstHit.object;
            const damage = weaponUpgraded ? 2 : 1;
            damageEnemy(hitEnemy, damage, false); // bullet hit, not shield
        }
    }

    // Auto reload if emptied
    if (ammo === 0) {
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

        // Enemy chasing logic & animations
        const playerPos = controlObj.position.clone();
        const currentSpeed = 2.0 + (currentRound * 0.5); // Enemies get faster

        enemies.forEach(e => {
            // Keep enemy upright but target player visually
            const targetPos = playerPos.clone();
            targetPos.y = e.position.y;
            e.lookAt(targetPos);

            // Vector math for absolute movement towards player
            const moveDir = new THREE.Vector3().subVectors(targetPos, e.position).normalize();

            // Attempt movement components independently
            const oldEX = e.position.x;
            const oldEZ = e.position.z;

            e.position.x += moveDir.x * currentSpeed * delta;
            if (checkCollision(e.position)) {
                e.position.x = oldEX; // Blocked along X
            }

            e.position.z += moveDir.z * currentSpeed * delta;
            if (checkCollision(e.position)) {
                e.position.z = oldEZ; // Blocked along Z
            }

            // Simple bobbing effect
            e.position.y = 1 + Math.sin(time / 400 + e.userData.offset) * 0.3;

            // Damage collision check
            const dist = e.position.distanceTo(playerPos);
            
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
            } else if (shieldState === 'thrown') {
                const moveDist = 30 * delta;

                // Penetrating Damage
                enemies.forEach(e => {
                    if (e.position.distanceTo(shieldGroup.position) < 1.5 && !shieldHits.includes(e)) {
                        shieldHits.push(e);
                        damageEnemy(e, 2, true); // Shield deals 2 base damage AND breaks armor
                    }
                });

                // Ricochet Physics & Collision
                const oldX = shieldGroup.position.x;
                const oldZ = shieldGroup.position.z;
                
                shieldGroup.position.x += shieldThrowDir.x * moveDist;
                const hitX = checkCollision(shieldGroup.position);
                shieldGroup.position.x = oldX;

                shieldGroup.position.z += shieldThrowDir.z * moveDist;
                const hitZ = checkCollision(shieldGroup.position);
                shieldGroup.position.z = oldZ;

                if (hitX || hitZ) {
                    if (shieldBouncesLeft > 0) {
                        shieldBouncesLeft--;
                        if (hitX) shieldThrowDir.x *= -1;
                        if (hitZ) shieldThrowDir.z *= -1;
                        playReloadSound(); // Metallic clink for bounce!
                        // Move safely along new vector this frame
                        shieldGroup.position.x += shieldThrowDir.x * moveDist;
                        shieldGroup.position.z += shieldThrowDir.z * moveDist;
                    } else {
                        shieldState = 'returning'; // Hit a wall without bounces left
                    }
                } else {
                    // Normal movement
                    shieldGroup.position.x += shieldThrowDir.x * moveDist;
                    shieldGroup.position.z += shieldThrowDir.z * moveDist;
                }
                
                // Maintain frisbee spin
                shieldGroup.rotation.set(-Math.PI / 2, 0, shieldGroup.rotation.z + (15 * delta));
            } else if (shieldState === 'returning') {
                const returnDir = new THREE.Vector3().subVectors(playerPos, shieldGroup.position).normalize();
                shieldGroup.position.addScaledVector(returnDir, 40 * delta); // Fly back faster
                shieldGroup.rotation.set(-Math.PI / 2, 0, shieldGroup.rotation.z + (15 * delta)); // Maintain frisbee spin

                if (shieldGroup.position.distanceTo(playerPos) < 1.5) {
                    shieldState = 'idle';
                    scene.remove(shieldGroup);
                    camera.add(shieldGroup);
                    shieldGroup.position.set(0, 0, -0.6); // Start returning from center loosely
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
