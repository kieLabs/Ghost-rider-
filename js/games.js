import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { AssetManager, FLAME_SKINS } from './assets.js';
import { SoundEngine } from './sound.js';
import { MISSIONS, getMissionById } from './missions.js';

const STORAGE_KEY = 'gamerkie_hellfire_rider_v1';

class SafeStorage {
  constructor() {
    this.memory = new Map();
  }
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return this.memory.get(key) ?? null;
    }
  }
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      this.memory.set(key, String(value));
    }
  }
}

class FireParticlePool {
  constructor(scene, maxCount = 360) {
    this.maxCount = maxCount;
    this.particles = [];
    this.cursor = 0;
    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color(0xff5a00);

    const geo = new THREE.SphereGeometry(0.24, 6, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    for (let i = 0; i < maxCount; i++) {
      this.particles.push({
        active: false,
        x: 0, y: -999, z: 0,
        vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 0.5,
        size: 1
      });
      this.dummy.position.set(0, -999, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.tmpColor);
    }
    scene.add(this.mesh);
  }

  emit(x, y, z, vx, vy, vz, size, maxLife, colorHex) {
    const idx = this.cursor;
    const p = this.particles[idx];
    this.cursor = (this.cursor + 1) % this.maxCount;
    p.active = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = maxLife;
    p.maxLife = maxLife;
    p.size = size;
    this.tmpColor.setHex(colorHex);
    this.mesh.setColorAt(idx, this.tmpColor);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.maxCount; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.dummy.position.set(0, -999, 0);
        this.dummy.scale.setScalar(0.001);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const ratio = p.life / p.maxLife;
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.scale.setScalar(Math.max(0.05, p.size * ratio));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

class HellfireRiderGame {
  constructor() {
    this.storage = new SafeStorage();
    this.saveData = this._loadSave();
    this.assets = new AssetManager();
    this.sound = new SoundEngine();

    this.container = document.getElementById('canvas-container');
    this.state = 'MENU';
    this.currentMission = getMissionById(1);
    this.cameraMode = 0;
    this.bloomEnabled = true;

    this.input = {
      boost: false,
      wasBoosting: false,
      keys: new Set(),
      joyActive: false,
      joyPointerId: null,
      joyX: 0,
      joyY: 0
    };

    this.timer = new THREE.Timer();
    this.timer.connect(document);

    this.missionGroup = null;
    this.particlePool = null;
    this.player = null;
    this.bossObj = null;

    this._initRenderer();
    this._initSceneBase();
    this._bindUI();
    this._bindInputs();
    this._setupResize();

    this.assets.preloadOptionalSlots();
    this._refreshMenuStats();
    this._buildShowcaseBackdrop();

    this.renderer.setAnimationLoop((ts) => this._tick(ts));
  }

  _loadSave() {
    const defaults = {
      coins: 250,
      unlockedMission: 1,
      stars: {},
      endlessBest: 0,
      upgrades: { topSpeed: 1, nitroCap: 1, chainPower: 1 },
      selectedSkin: 'hellfire',
      unlockedSkins: ['hellfire']
    };
    const raw = this.storage.get(STORAGE_KEY);
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        upgrades: { ...defaults.upgrades, ...(parsed.upgrades || {}) }
      };
    } catch {
      return defaults;
    }
  }

  _persistSave() {
    this.storage.set(STORAGE_KEY, JSON.stringify(this.saveData));
  }

  _initRenderer() {
    const useAA = (window.devicePixelRatio || 1) < 2;
    this.renderer = new THREE.WebGLRenderer({ antialias: useAA, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(
      this.container.clientWidth || window.innerWidth,
      this.container.clientHeight || window.innerHeight
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, w / h, 0.2, 360);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.35, 0.72);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  _initSceneBase() {
    this.hemiLight = new THREE.HemisphereLight(0x526499, 0x1a0b12, 0.9);
    this.scene.add(this.hemiLight);

    this.moonLight = new THREE.DirectionalLight(0xcfe4ff, 1.8);
    this.moonLight.position.set(28, 46, -55);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(1024, 1024);
    this.moonLight.shadow.camera.near = 5;
    this.moonLight.shadow.camera.far = 160;
    const d = 32;
    this.moonLight.shadow.camera.left = -d;
    this.moonLight.shadow.camera.right = d;
    this.moonLight.shadow.camera.top = d;
    this.moonLight.shadow.camera.bottom = -d;
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    this.particlePool = new FireParticlePool(this.scene, 360);
  }

  _setupResize() {
    const handleResize = () => {
      const w = Math.max(1, this.container.clientWidth || window.innerWidth);
      const h = Math.max(1, this.container.clientHeight || window.innerHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(handleResize);
      this.resizeObserver.observe(this.container);
    }
  }

  _disposeObject3D(obj) {
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
          if (mat.map) mat.map.dispose();
          if (mat.emissiveMap) mat.emissiveMap.dispose();
          mat.dispose();
        });
      }
    });
  }

  _buildShowcaseBackdrop() {
    this._clearMissionScene();
    const m = getMissionById(1);
    this.scene.background = new THREE.Color(m.skyTop);
    this.scene.fog = new THREE.FogExp2(m.fogColor, 0.011);
    this.missionGroup = new THREE.Group();
    this.scene.add(this.missionGroup);

    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(14, 24, 24),
      new THREE.MeshBasicMaterial({ color: m.moonColor })
    );
    moon.position.set(18, 28, -95);
    this.missionGroup.add(moon);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(12, 1, 60),
      new THREE.MeshStandardMaterial({ color: 0x221f2b, roughness: 0.9 })
    );
    floor.position.set(0, -0.5, -15);
    this.missionGroup.add(floor);

    this.player = this.assets.createRiderAndBike(this.saveData.selectedSkin);
    this.player.root.position.set(0, 0, 0);
    this.player.root.rotation.y = 0.35;
    this.missionGroup.add(this.player.root);

    this.camera.position.set(4.5, 2.4, 5.2);
    this.camera.lookAt(0, 1.15, -0.3);
  }

  _clearMissionScene() {
    if (!this.missionGroup) return;
    this._disposeObject3D(this.missionGroup);
    this.scene.remove(this.missionGroup);
    this.missionGroup = null;
    this.player = null;
    this.bossObj = null;
  }

  _roadCenterX(z, mission) {
    if (!mission.curveAmp) return 0;
    return Math.sin(z * 0.018) * mission.curveAmp;
  }

  startMission(missionId) {
    this.sound.startEngine();
    this.currentMission = getMissionById(missionId);
    const m = this.currentMission;

    this._clearMissionScene();
    this.scene.background = new THREE.Color(m.skyTop);
    this.scene.fog = new THREE.FogExp2(m.fogColor, 0.012);
    this.moonLight.color.setHex(m.moonColor);

    this.missionGroup = new THREE.Group();
    this.scene.add(this.missionGroup);

    this.skyBackdrop = new THREE.Group();
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(16, 24, 24),
      new THREE.MeshBasicMaterial({ color: m.moonColor })
    );
    moon.position.set(22, 34, -135);
    this.skyBackdrop.add(moon);
    this.missionGroup.add(this.skyBackdrop);

    this.player = this.assets.createRiderAndBike(this.saveData.selectedSkin);
    this.missionGroup.add(this.player.root);

    const u = this.saveData.upgrades;
    this.stats = {
      baseMaxSpeed: 42 + (u.topSpeed - 1) * 5,
      nitroMax: 100 + (u.nitroCap - 1) * 25,
      chainDamage: 55 + (u.chainPower - 1) * 20
    };

    this.run = {
      x: 0,
      y: 0,
      z: 0,
      vy: 0,
      speed: 14,
      grounded: true,
      flipAngle: 0,
      isStunting: false,
      hp: 100,
      nitro: this.stats.nitroMax,
      padBoostTimer: 0,
      timeLeft: m.timeLimit,
      elapsed: 0,
      progress: 0,
      kills: 0,
      stunts: 0,
      coinsEarned: 0,
      invulnTimer: 0,
      attackCd: 0,
      attackAnimTimer: 0,
      warnedMoreTargets: false,
      nextSegmentZ: 20,
      segmentLen: 26,
      segments: [],
      obstacles: [],
      orbs: [],
      enemies: [],
      projectiles: [],
      bossBeams: [],
      hellgateMesh: null
    };

    for (let i = 0; i < 14; i++) {
      this._spawnRoadSegment();
    }

    if (m.bossHp > 0) {
      const bossVisual = this.assets.createDragonBoss();
      bossVisual.root.position.set(0, 8.5, -52);
      this.missionGroup.add(bossVisual.root);
      this.bossObj = {
        ...bossVisual,
        hp: m.bossHp,
        maxHp: m.bossHp,
        x: 0,
        y: 8.5,
        zOffset: -46,
        attackTimer: 3.5,
        telegraphTimer: 0,
        targetLaneX: 0
      };
      document.getElementById('boss-hud').classList.remove('hidden');
      document.getElementById('boss-name').textContent = m.bossName;
      document.getElementById('bar-boss').style.width = '100%';
    } else {
      document.getElementById('boss-hud').classList.add('hidden');
    }

    this._hideAllModals();
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('hud-mission-badge').textContent = m.shortBadge;
    this.state = 'PLAYING';
    this._updateHUD();
    this._showToast(`${m.code}: ${m.title.toUpperCase()}`);
  }

  _spawnRoadSegment() {
    const m = this.currentMission;
    const len = this.run.segmentLen;
    const zCenter = this.run.nextSegmentZ - len * 0.5;
    const xCenter = this._roadCenterX(zCenter, m);

    const isGap = m.hasGaps && this.run.nextSegmentZ < -140 && Math.random() < 0.14;
    const segGroup = new THREE.Group();
    segGroup.position.set(xCenter, 0, zCenter);

    if (!isGap) {
      const road = new THREE.Mesh(
        new THREE.BoxGeometry(m.roadWidth, 1.2, len + 0.6),
        new THREE.MeshStandardMaterial({
          color: m.id === 4 ? 0x161820 : 0x2a2533,
          roughness: 0.88
        })
      );
      road.position.y = -0.6;
      road.receiveShadow = true;
      segGroup.add(road);

      if (m.hasRailings) {
        const railMat = new THREE.MeshStandardMaterial({ color: 0x3b3446, roughness: 0.85 });
        for (const s of [-1, 1]) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.9, len), railMat);
          wall.position.set(s * (m.roadWidth * 0.5 + 0.25), 0.45, 0);
          segGroup.add(wall);
        }
      }
    } else {
      const rampZ = zCenter + len * 0.68;
      const rampX = this._roadCenterX(rampZ, m);
      const ramp = this.assets.createRamp();
      ramp.position.set(rampX, 0.25, rampZ);
      this.missionGroup.add(ramp);
      this.run.obstacles.push({
        type: 'ramp',
        mesh: ramp,
        x: rampX,
        z: rampZ,
        active: true
      });
    }

    if (Math.random() < 0.28) {
      const arch = this.assets.createRuinedArch(m.roadWidth);
      segGroup.add(arch);
    }

    this.missionGroup.add(segGroup);
    this.run.segments.push({
      group: segGroup,
      zCenter,
      zEnd: zCenter - len * 0.5,
      xCenter,
      isGap
    });

    if (!isGap && zCenter < -45) {
      this._populateSegment(zCenter, xCenter);
    }

    if (!this.run.hellgateMesh && m.distanceGoal < 50000 && Math.abs(zCenter) >= m.distanceGoal) {
      const gate = this.assets.createRuinedArch(m.roadWidth + 1.5);
      const portal = new THREE.Mesh(
        new THREE.PlaneGeometry(m.roadWidth * 0.85, 7.5),
        new THREE.MeshBasicMaterial({
          color: 0xff6a00,
          transparent: true,
          opacity: 0.48,
          side: THREE.DoubleSide
        })
      );
      portal.position.y = 3.8;
      gate.add(portal);
      gate.position.set(xCenter, 0, -m.distanceGoal);
      this.missionGroup.add(gate);
      this.run.hellgateMesh = gate;
    }

    this.run.nextSegmentZ -= len;
  }

  _populateSegment(zCenter, xCenter) {
    const m = this.currentMission;
    const laneLimit = m.roadWidth * 0.36;
    const randX = () => xCenter + (Math.random() * 2 - 1) * laneLimit;

    if (Math.random() < m.axeDensity) {
      const axe = this.assets.createSwingingAxe(m.roadWidth);
      axe.position.set(xCenter, 8.6, zCenter);
      this.missionGroup.add(axe);
      this.run.obstacles.push({
        type: 'axe',
        mesh: axe,
        x: xCenter,
        z: zCenter,
        phase: Math.random() * Math.PI * 2,
        active: true
      });
    }

    if (Math.random() < m.barricadeDensity) {
      const bx = randX();
      const bar = this.assets.createBarricade();
      bar.position.set(bx, 0, zCenter - 6);
      this.missionGroup.add(bar);
      this.run.obstacles.push({
        type: 'barricade',
        mesh: bar,
        x: bx,
        z: zCenter - 6,
        active: true
      });
    }

    if (Math.random() < m.fireTrapDensity) {
      const fx = randX();
      const trap = this.assets.createFireTrap();
      trap.position.set(fx, 0, zCenter + 1);
      this.missionGroup.add(trap);
      this.run.obstacles.push({
        type: 'fireTrap',
        mesh: trap,
        x: fx,
        z: zCenter + 1,
        active: true
      });
    }

    if (Math.random() < m.boostPadDensity) {
      const px = randX();
      const pad = this.assets.createBoostPad();
      pad.position.set(px, 0.05, zCenter - 1);
      this.missionGroup.add(pad);
      this.run.obstacles.push({
        type: 'boostPad',
        mesh: pad,
        x: px,
        z: zCenter - 1,
        active: true
      });
    }

    if (Math.random() < m.rampDensity) {
      const rx = randX();
      const ramp = this.assets.createRamp();
      ramp.position.set(rx, 0, zCenter + 4);
      this.missionGroup.add(ramp);
      this.run.obstacles.push({
        type: 'ramp',
        mesh: ramp,
        x: rx,
        z: zCenter + 4,
        active: true
      });
    }

    if (Math.random() < m.enemyDensity) {
      const ex = randX();
      const eType = m.id === 4 ? 'biker' : 'totem';
      const enemyMesh = this.assets.createCursedTarget(eType);
      enemyMesh.position.set(ex, 0, zCenter - 2);
      this.missionGroup.add(enemyMesh);
      this.run.enemies.push({
        type: eType,
        mesh: enemyMesh,
        x: ex,
        z: zCenter - 2,
        hp: eType === 'biker' ? 80 : 50,
        active: true
      });
    }

    if (Math.random() < m.orbDensity) {
      const colors = [0x38bdf8, 0x4ade80, 0xfbbf24];
      const ox = randX();
      const orb = this.assets.createOrb(colors[Math.floor(Math.random() * colors.length)]);
      orb.position.set(ox, 1.25, zCenter + 6);
      this.missionGroup.add(orb);
      this.run.orbs.push({ mesh: orb, x: ox, z: zCenter + 6, active: true });
    }

    if (m.objectiveType === 'checkpoints' && Math.abs(zCenter) % 234 < this.run.segmentLen) {
      const cp = this.assets.createOrb(0xff6a00);
      cp.scale.setScalar(1.8);
      cp.position.set(xCenter, 2.0, zCenter);
      this.missionGroup.add(cp);
      this.run.orbs.push({ mesh: cp, x: xCenter, z: zCenter, isCheckpoint: true, active: true });
    }
  }

  _tick(timestamp) {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const elapsed = this.timer.getElapsed();

    if (this.state === 'MENU' && this.player) {
      this.player.root.rotation.y = Math.sin(elapsed * 0.45) * 0.45 + 0.3;
      this._emitBikeFlames(false, elapsed);
      this.particlePool.update(dt);
      this._renderScene();
      return;
    }

    if (this.state === 'PLAYING') {
      this._updatePlaying(dt, elapsed);
      this.particlePool.update(dt);
    }

    this._renderScene();
  }

  _renderScene() {
    if (this.bloomEnabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  _updatePlaying(dt, elapsed) {
    const m = this.currentMission;
    const r = this.run;
    r.elapsed += dt;

    if (m.timeLimit > 0) {
      r.timeLeft = Math.max(0, r.timeLeft - dt);
      if (r.timeLeft <= 0) {
        this._endMission(false, 'Time ran out before completing the Hellfire Mission.');
        return;
      }
    }

    const keySteer =
      (this.input.keys.has('KeyD') || this.input.keys.has('ArrowRight') ? 1 : 0) -
      (this.input.keys.has('KeyA') || this.input.keys.has('ArrowLeft') ? 1 : 0);
    const keyThrottle =
      (this.input.keys.has('KeyW') || this.input.keys.has('ArrowUp') ? 1 : 0) -
      (this.input.keys.has('KeyS') || this.input.keys.has('ArrowDown') ? 1 : 0);

    const steer = THREE.MathUtils.clamp(keySteer + this.input.joyX, -1, 1);
    const throttle = this.input.joyActive
      ? THREE.MathUtils.clamp(Math.max(0.45, -this.input.joyY) + keyThrottle, -1, 1)
      : keyThrottle !== 0
      ? keyThrottle
      : 0.55;

    if (r.padBoostTimer > 0) r.padBoostTimer = Math.max(0, r.padBoostTimer - dt);

    const wantBoost =
      this.input.boost ||
      this.input.keys.has('ShiftLeft') ||
      this.input.keys.has('ShiftRight');
    const isBoosting = (wantBoost && r.nitro > 2) || r.padBoostTimer > 0;

    if (isBoosting && !this.input.wasBoosting) {
      this.sound.playFlameBurst();
    }
    this.input.wasBoosting = isBoosting;

    if (wantBoost && r.nitro > 2) {
      r.nitro = Math.max(0, r.nitro - 26 * dt);
    } else {
      r.nitro = Math.min(this.stats.nitroMax, r.nitro + 7.5 * dt);
    }
    document.getElementById('speed-lines').classList.toggle('active', isBoosting);

    const endlessBonus = m.id === 7 ? Math.min(28, Math.abs(r.z) * 0.004) : 0;
    const targetSpeed =
      throttle < 0
        ? 12
        : (this.stats.baseMaxSpeed + endlessBonus) *
          (0.65 + 0.35 * Math.max(0, throttle)) *
          (isBoosting ? 1.48 : 1);

    r.speed = THREE.MathUtils.damp(r.speed, targetSpeed, 3.2, dt);
    r.z -= r.speed * dt;
    r.x += steer * 15.5 * dt;

    if (m.hasWind) {
      r.x += Math.sin(elapsed * 0.85) * 1.9 * dt;
    }

    const centerAtPlayer = this._roadCenterX(r.z, m);
    const maxOffset = m.roadWidth * 0.5;
    const overGap = this._isOverGap(r.z);

    if (m.hasRailings) {
      if (r.x > centerAtPlayer + maxOffset - 0.65) {
        r.x = centerAtPlayer + maxOffset - 0.65;
      } else if (r.x < centerAtPlayer - maxOffset + 0.65) {
        r.x = centerAtPlayer - maxOffset + 0.65;
      }
    } else if (Math.abs(r.x - centerAtPlayer) > maxOffset + 0.4) {
      r.grounded = false;
    }

    if (overGap && r.y <= 0.15) {
      r.grounded = false;
    }
    if (!r.grounded) {
      r.vy -= 30 * dt;
      r.y += r.vy * dt;
      if (r.isStunting) {
        r.flipAngle += dt * 7.2;
      }
      const safeRoad = !overGap && Math.abs(r.x - centerAtPlayer) <= maxOffset + 0.25;
      if (safeRoad && r.y <= 0) {
        r.y = 0;
        r.vy = 0;
        r.grounded = true;
        if (r.isStunting && r.flipAngle > Math.PI * 1.1) {
          r.stunts += 1;
          r.coinsEarned += 25;
          r.nitro = Math.min(this.stats.nitroMax, r.nitro + 25);
          this._showToast('HELLFIRE STUNT! +25 COINS');
        }
        r.isStunting = false;
        r.flipAngle = 0;
      } else if (r.y < -14) {
        this._endMission(false, 'You plunged off the abyss into the underworld!');
        return;
      }
    }

    this.player.root.position.set(r.x, r.y, r.z);
    this.player.tiltGroup.rotation.z = THREE.MathUtils.damp(
      this.player.tiltGroup.rotation.z,
      -steer * 0.36,
      10,
      dt
    );
    this.player.tiltGroup.rotation.x = r.isStunting ? -r.flipAngle : r.vy > 1 ? 0.14 : 0;

    if (this.player.frontWheel) this.player.frontWheel.rotation.x -= r.speed * dt * 1.4;
    if (this.player.rearWheel) this.player.rearWheel.rotation.x -= r.speed * dt * 1.4;
    if (this.player.riderAnimMixer) this.player.riderAnimMixer.update(dt);

    if (r.attackAnimTimer > 0) {
      r.attackAnimTimer -= dt;
      if (this.player.riderRig) {
        this.player.riderRig.rightArmPivot.rotation.x =
          -1.1 * Math.sin((r.attackAnimTimer / 0.28) * Math.PI);
      }
    }

    if (r.attackCd > 0) r.attackCd = Math.max(0, r.attackCd - dt);
    if (r.invulnTimer > 0) r.invulnTimer = Math.max(0, r.invulnTimer - dt);

    if (this.skyBackdrop) this.skyBackdrop.position.z = r.z;
    this.moonLight.position.set(r.x + 28, 46, r.z - 55);
    this.moonLight.target.position.set(r.x, 0, r.z - 12);

    while (r.nextSegmentZ > r.z - 220) {
      this._spawnRoadSegment();
    }
    this._prunePassedObjects();

    this._updateObstacles(dt, elapsed, isBoosting);
    this._updateOrbs(dt, elapsed);
    this._updateEnemies(dt);
    this._updateProjectiles(dt);
    if (this.bossObj) this._updateBoss(dt, elapsed);

    this._emitBikeFlames(isBoosting, elapsed);
    this.sound.updateEngine(THREE.MathUtils.clamp(r.speed / 70, 0, 1), isBoosting, true);

    if (
      m.objectiveType === 'orbs_distance' ||
      m.objectiveType === 'checkpoints' ||
      m.objectiveType === 'kills'
    ) {
      if (Math.abs(r.z) >= m.distanceGoal) {
        if (r.progress >= m.targetCount) {
          this._endMission(true, `${m.title} cleared!`);
          return;
        }
        if (!r.warnedMoreTargets) {
          r.warnedMoreTargets = true;
          this._showToast(`KEEP RIDING — ${m.targetCount - r.progress} MORE TARGETS NEEDED!`);
        }
      }
    }

    this._updateCamera(dt, steer, isBoosting);
    this._updateHUD();
  }

  _isOverGap(z) {
    for (const seg of this.run.segments) {
      if (seg.isGap && Math.abs(z - seg.zCenter) < this.run.segmentLen * 0.45) {
        return true;
      }
    }
    return false;
  }

  _prunePassedObjects() {
    const cutoff = this.run.z + 36;

    this.run.segments = this.run.segments.filter((seg) => {
      if (seg.zEnd > cutoff) {
        this._disposeObject3D(seg.group);
        this.missionGroup.remove(seg.group);
        return false;
      }
      return true;
    });

    const pruneList = (list) =>
      list.filter((item) => {
        if (!item.active || item.z > cutoff) {
          if (item.mesh && item.mesh.parent) {
            this._disposeObject3D(item.mesh);
            item.mesh.parent.remove(item.mesh);
          }
          return false;
        }
        return true;
      });

    this.run.obstacles = pruneList(this.run.obstacles);
    this.run.orbs = pruneList(this.run.orbs);
    this.run.enemies = pruneList(this.run.enemies);
  }

  _updateObstacles(dt, elapsed, isBoosting) {
    const r = this.run;
    for (const obs of r.obstacles) {
      if (!obs.active) continue;
      if (obs.type === 'axe') {
        const swingAngle = Math.sin(elapsed * 2.5 + obs.phase) * 0.85;
        obs.mesh.rotation.z = swingAngle;
        const bladeX = obs.x + Math.sin(swingAngle) * 7.0;
        const bladeY = 8.6 - Math.cos(swingAngle) * 7.0;
        if (
          Math.abs(r.z - obs.z) < 1.35 &&
          Math.abs(r.x - bladeX) < 1.65 &&
          Math.abs(r.y + 1.0 - bladeY) < 1.45
        ) {
          this._applyDamage(24, 'Sliced by a Giant Pendulum Axe!');
          this.sound.playWhoosh();
        }
      } else if (obs.type === 'barricade') {
        if (Math.abs(r.z - obs.z) < 1.3 && Math.abs(r.x - obs.x) < 1.6 && r.y < 1.1) {
          obs.active = false;
          if (isBoosting) {
            r.kills += 1;
            r.coinsEarned += 20;
            if (this.currentMission.objectiveType === 'kills') r.progress += 1;
            this.sound.playHit();
            this._burstSparks(obs.x, 1.0, obs.z, 0xff7700);
          } else {
            this._applyDamage(20, 'Smashed into a cursed barricade!');
          }
        }
      } else if (obs.type === 'fireTrap') {
        obs.mesh.children[1].scale.y = 0.85 + Math.sin(elapsed * 16 + obs.z) * 0.25;
        if (Math.abs(r.z - obs.z) < 1.35 && Math.abs(r.x - obs.x) < 1.35 && r.y < 1.8) {
          this._applyDamage(18, 'Engulfed by a Hellfire Geyser Trap!');
        }
      } else if (obs.type === 'boostPad') {
        if (Math.abs(r.z - obs.z) < 2.2 && Math.abs(r.x - obs.x) < 1.7 && r.y < 0.8) {
          obs.active = false;
          r.padBoostTimer = 1.6;
          r.nitro = Math.min(this.stats.nitroMax, r.nitro + 30);
          this.sound.playFlameBurst();
          this._showToast('NITRO ZONE BOOST!');
        }
      } else if (obs.type === 'ramp') {
        if (r.grounded && Math.abs(r.z - obs.z) < 2.3 && Math.abs(r.x - obs.x) < 2.0) {
          r.vy = 14.5;
          r.grounded = false;
          r.isStunting = true;
          r.flipAngle = 0;
          this.sound.playJump();
        }
      }
    }
  }

  _updateOrbs(dt, elapsed) {
    const r = this.run;
    for (const orb of r.orbs) {
      if (!orb.active) continue;
      orb.mesh.rotation.y += dt * 2.5;
      orb.mesh.position.y = (orb.isCheckpoint ? 2.0 : 1.25) + Math.sin(elapsed * 4 + orb.z) * 0.22;

      const hitWidth = orb.isCheckpoint ? 3.5 : 1.75;
      if (Math.abs(r.z - orb.z) < 1.9 && Math.abs(r.x - orb.x) < hitWidth && r.y < 3.6) {
        orb.active = false;
        this.sound.playPickup();
        r.nitro = Math.min(this.stats.nitroMax, r.nitro + 18);
        r.coinsEarned += orb.isCheckpoint ? 40 : 15;
        if (orb.isCheckpoint && this.currentMission.objectiveType === 'checkpoints') {
          r.progress += 1;
          this._showToast(`CHECKPOINT ${r.progress}/${this.currentMission.targetCount}`);
        } else if (!orb.isCheckpoint && this.currentMission.objectiveType === 'orbs_distance') {
          r.progress += 1;
        }
      }
    }
  }

  _updateEnemies(dt) {
    const r = this.run;
    for (const en of r.enemies) {
      if (!en.active) continue;
      if (en.type === 'biker') {
        en.z -= 16 * dt;
        en.mesh.position.z = en.z;
      } else {
        en.mesh.rotation.y += dt * 1.8;
      }
      if (Math.abs(r.z - en.z) < 1.6 && Math.abs(r.x - en.x) < 1.5 && r.y < 1.8) {
        en.active = false;
        this._applyDamage(22, 'Collided with a Cursed Guardian!');
      }
    }
  }

  triggerChainAttack() {
    if (this.state !== 'PLAYING' || this.run.attackCd > 0) return;
    this.run.attackCd = 0.42;
    this.run.attackAnimTimer = 0.28;
    this.sound.playChainStrike();

    const skin = FLAME_SKINS[this.saveData.selectedSkin] || FLAME_SKINS.hellfire;
    const projMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 8, 8),
      new THREE.MeshBasicMaterial({ color: skin.flameCore })
    );
    projMesh.position.set(this.run.x + 0.3, this.run.y + 1.55, this.run.z - 1.2);
    this.missionGroup.add(projMesh);

    this.run.projectiles.push({
      mesh: projMesh,
      x: projMesh.position.x,
      y: projMesh.position.y,
      z: projMesh.position.z,
      life: 1.6
    });
  }

  triggerJump() {
    if (this.state !== 'PLAYING' || !this.run.grounded) return;
    this.run.vy = 11.8;
    this.run.grounded = false;
    this.sound.playJump();
  }

  _updateProjectiles(dt) {
    const r = this.run;
    for (let i = r.projectiles.length - 1; i >= 0; i--) {
      const p = r.projectiles[i];
      p.life -= dt;

      let target = null;
      let bestDist = 75;
      for (const en of r.enemies) {
        if (!en.active) continue;
        const d = Math.hypot(en.x - p.x, en.z - p.z);
        if (en.z < p.z + 4 && d < bestDist) {
          bestDist = d;
          target = { x: en.x, y: 1.4, z: en.z, ref: en, isBoss: false };
        }
      }
      if (!target && this.bossObj && this.bossObj.hp > 0) {
        target = {
          x: this.bossObj.root.position.x,
          y: this.bossObj.root.position.y + 0.8,
          z: this.bossObj.root.position.z,
          ref: this.bossObj,
          isBoss: true
        };
      }

      if (target) {
        const dir = new THREE.Vector3(target.x - p.x, target.y - p.y, target.z - p.z).normalize();
        const spd = 92;
        p.x += dir.x * spd * dt;
        p.y += dir.y * spd * dt;
        p.z += dir.z * spd * dt;
      } else {
        p.z -= 95 * dt;
      }

      p.mesh.position.set(p.x, p.y, p.z);
      this.particlePool.emit(p.x, p.y, p.z, 0, 0.5, 2, 0.7, 0.18, 0xffae00);

      let hit = false;
      if (target && Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z) < (target.isBoss ? 3.5 : 2.1)) {
        hit = true;
        this.sound.playHit();
        this._burstSparks(p.x, p.y, p.z, 0xff5500);
        if (target.isBoss) {
          this.bossObj.hp = Math.max(0, this.bossObj.hp - this.stats.chainDamage);
          document.getElementById('bar-boss').style.width = `${(this.bossObj.hp / this.bossObj.maxHp) * 100}%`;
          r.coinsEarned += 20;
          if (this.bossObj.hp <= 0) {
            this._endMission(true, `You vanquished ${this.currentMission.bossName}!`);
            return;
          }
        } else {
          target.ref.hp -= this.stats.chainDamage;
          if (target.ref.hp <= 0) {
            target.ref.active = false;
            r.kills += 1;
            r.coinsEarned += 30;
            if (this.currentMission.objectiveType === 'kills') r.progress += 1;
          }
        }
      }

      if (hit || p.life <= 0) {
        this.missionGroup.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        r.projectiles.splice(i, 1);
      }
    }
  }

  _updateBoss(dt, elapsed) {
    const b = this.bossObj;
    const r = this.run;
    const center = this._roadCenterX(r.z + b.zOffset, this.currentMission);

    if (b.leftWing) b.leftWing.rotation.z = Math.sin(elapsed * 7.5) * 0.45;
    if (b.rightWing) b.rightWing.rotation.z = -Math.sin(elapsed * 7.5) * 0.45;

    b.x = center + Math.sin(elapsed * 1.1) * (this.currentMission.roadWidth * 0.34);
    b.root.position.set(b.x, b.y + Math.sin(elapsed * 2.2) * 1.1, r.z + b.zOffset);
    b.root.lookAt(r.x, r.y + 1.2, r.z);

    b.attackTimer -= dt;
    if (b.attackTimer <= 0 && b.telegraphTimer <= 0) {
      b.telegraphTimer = 1.2;
      b.targetLaneX = THREE.MathUtils.clamp(
        r.x,
        center - this.currentMission.roadWidth * 0.38,
        center + this.currentMission.roadWidth * 0.38
      );
      const beamMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.9, 26, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.78 })
      );
      beamMesh.position.set(b.targetLaneX, 4.5, r.z - 22);
      beamMesh.rotation.x = 0.45;
      this.missionGroup.add(beamMesh);
      r.bossBeams.push({ mesh: beamMesh, x: b.targetLaneX, z: r.z - 22, life: 1.35, hitDone: false });
      this.sound.playFlameBurst();
      this._showToast('DRAGON FIRE BEAM INCOMING!');
    }

    if (b.telegraphTimer > 0) {
      b.telegraphTimer -= dt;
      if (b.telegraphTimer <= 0) {
        b.attackTimer = 2.8;
      }
    }

    for (let i = r.bossBeams.length - 1; i >= 0; i--) {
      const bm = r.bossBeams[i];
      bm.life -= dt;
      if (!bm.hitDone && Math.abs(r.z - bm.z) < 2.2 && Math.abs(r.x - bm.x) < 1.95 && r.y < 2.5) {
        bm.hitDone = true;
        this._applyDamage(25, 'Scorched by Dragon Fire Beam!');
      }
      if (bm.life <= 0) {
        this.missionGroup.remove(bm.mesh);
        bm.mesh.geometry.dispose();
        bm.mesh.material.dispose();
        r.bossBeams.splice(i, 1);
      }
    }
  }

  _applyDamage(amount, reason) {
    if (this.run.invulnTimer > 0) return;
    this.run.hp = Math.max(0, this.run.hp - amount);
    this.run.invulnTimer = 0.85;
    this.sound.playHit();

    const flash = document.getElementById('damage-flash');
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 180);

    if (this.run.hp <= 0) {
      this._endMission(false, reason);
    }
  }

  _emitBikeFlames(isBoosting, elapsed) {
    if (!this.player) return;
    const skin = FLAME_SKINS[this.saveData.selectedSkin] || FLAME_SKINS.hellfire;
    const worldPos = new THREE.Vector3();

    const flicker = 1 + Math.sin(elapsed * 26) * 0.18;
    this.player.skullLight.intensity = 6.2 * flicker;
    this.player.wheelLight.intensity = (isBoosting ? 9.5 : 5.0) * flicker;

    worldPos.copy(this.player.anchors.skull).applyMatrix4(this.player.tiltGroup.matrixWorld);
    this.particlePool.emit(
      worldPos.x + (Math.random() - 0.5) * 0.16,
      worldPos.y,
      worldPos.z + (Math.random() - 0.5) * 0.16,
      (Math.random() - 0.5) * 0.8,
      2.6 + Math.random() * 1.4,
      2.0,
      0.85,
      0.28,
      Math.random() > 0.35 ? skin.flamePrimary : skin.flameCore
    );

    worldPos.copy(this.player.anchors.rear).applyMatrix4(this.player.tiltGroup.matrixWorld);
    const count = isBoosting ? 3 : 1;
    for (let i = 0; i < count; i++) {
      this.particlePool.emit(
        worldPos.x + (Math.random() - 0.5) * 0.3,
        worldPos.y,
        worldPos.z + 0.35,
        (Math.random() - 0.5) * 1.1,
        1.2 + Math.random() * 1.5,
        6.5 + (isBoosting ? 6.0 : 0),
        isBoosting ? 1.45 : 1.0,
        0.34,
        i === 0 ? skin.flameCore : skin.flamePrimary
      );
    }
  }

  _burstSparks(x, y, z, colorHex) {
    for (let i = 0; i < 16; i++) {
      this.particlePool.emit(
        x, y, z,
        (Math.random() - 0.5) * 14,
        Math.random() * 10,
        (Math.random() - 0.5) * 14,
        1.1,
        0.4,
        colorHex
      );
    }
  }

  _updateCamera(dt, steer, isBoosting) {
    const r = this.run;
    let targetPos;
    let lookTarget;
    let targetFov = isBoosting ? 78 : 64;

    if (this.cameraMode === 0) {
      targetPos = new THREE.Vector3(r.x - steer * 1.1, r.y + 3.4, r.z + (isBoosting ? 8.6 : 7.4));
      lookTarget = new THREE.Vector3(r.x, r.y + 1.4, r.z - 12);
    } else if (this.cameraMode === 1) {
      targetPos = new THREE.Vector3(r.x + 3.6, r.y + 2.5, r.z + 6.2);
      lookTarget = new THREE.Vector3(r.x - 0.6, r.y + 1.4, r.z - 10);
    } else {
      targetPos = new THREE.Vector3(r.x, r.y + 11.5, r.z + 11.5);
      lookTarget = new THREE.Vector3(r.x, r.y + 0.5, r.z - 16);
      targetFov = 58;
    }

    this.camera.position.lerp(targetPos, Math.min(1, dt * 7.5));
    this.camera.lookAt(lookTarget);
    const nextFov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
    if (Math.abs(nextFov - this.camera.fov) > 0.01) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  _updateHUD() {
    const r = this.run;
    const m = this.currentMission;

    let objStr = `${r.progress} / ${m.targetCount}`;
    if (m.objectiveType === 'boss' && this.bossObj) {
      objStr = `BOSS ${Math.ceil(this.bossObj.hp)} HP`;
    } else if (m.objectiveType === 'endless') {
      objStr = `${Math.floor(Math.abs(r.z))} m`;
    }
    document.getElementById('hud-objective-text').textContent = objStr;

    const tSec = m.timeLimit > 0 ? Math.ceil(r.timeLeft) : Math.floor(r.elapsed);
    const mm = String(Math.floor(tSec / 60)).padStart(2, '0');
    const ss = String(tSec % 60).padStart(2, '0');
    document.getElementById('hud-timer-text').textContent = `${mm}:${ss}`;

    document.getElementById('bar-health').style.width = `${r.hp}%`;
    document.getElementById('bar-nitro').style.width = `${(r.nitro / this.stats.nitroMax) * 100}%`;
    document.getElementById('hud-coins').textContent = this.saveData.coins + r.coinsEarned;
    document.getElementById('hud-speed').textContent = Math.round(r.speed * 3.1);

    const cdRing = document.getElementById('attack-cd-ring');
    cdRing.style.transform = `scaleY(${THREE.MathUtils.clamp(r.attackCd / 0.42, 0, 1)})`;
  }

  _endMission(won, reason) {
    this.state = 'SUMMARY';
    this.sound.updateEngine(0, false, false);
    document.getElementById('speed-lines').classList.remove('active');

    const m = this.currentMission;
    let totalCoins = this.run.coinsEarned;
    let stars = 0;

    if (won) {
      this.sound.playMissionComplete();
      totalCoins += m.rewardCoins;
      stars = this.run.hp >= 75 ? 3 : this.run.hp >= 40 ? 2 : 1;
      this.saveData.stars[m.id] = Math.max(this.saveData.stars[m.id] || 0, stars);
      if (m.id >= this.saveData.unlockedMission && m.id < 6) {
        this.saveData.unlockedMission = m.id + 1;
      }
    } else {
      this.sound.playGameOver();
    }

    if (m.id === 7) {
      const dist = Math.floor(Math.abs(this.run.z));
      totalCoins += Math.floor(dist * 0.08);
      this.saveData.endlessBest = Math.max(this.saveData.endlessBest || 0, dist);
    }

    this.saveData.coins += totalCoins;
    this._persistSave();
    this._refreshMenuStats();

    document.getElementById('hud').classList.add('hidden');
    document.getElementById('summary-heading').textContent = won ? 'MISSION COMPLETE!' : 'MISSION FAILED';
    document.getElementById('summary-stars').textContent = won ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '☆☆☆';
    document.getElementById('summary-reason').textContent = reason;

    const el = Math.floor(this.run.elapsed);
    document.getElementById('summary-time').textContent = `${String(Math.floor(el / 60)).padStart(2, '0')}:${String(el % 60).padStart(2, '0')}`;
    document.getElementById('summary-coins').textContent = `+${totalCoins}`;
    document.getElementById('summary-score').textContent = `${this.run.kills} Kills / ${this.run.stunts} Stunts`;

    const nextBtn = document.getElementById('btn-summary-next');
    nextBtn.classList.toggle('hidden', !won || m.id >= 6);
    document.getElementById('screen-summary').classList.add('active');
  }

  _showToast(msg) {
    const el = document.getElementById('hud-toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  _hideAllModals() {
    document.querySelectorAll('.overlay-screen').forEach((el) => el.classList.remove('active'));
  }

  _openBriefing(missionId) {
    const m = getMissionById(missionId);
    this.pendingMissionId = m.id;
    this._hideAllModals();
    document.getElementById('brief-title').textContent = `${m.code}: ${m.title.toUpperCase()}`;
    document.getElementById('brief-desc').textContent = m.description;
    document.getElementById('brief-obj').textContent =
      m.objectiveType === 'boss'
        ? `Defeat Boss (${m.bossHp} HP)`
        : m.objectiveType === 'endless'
        ? 'Survive & Farm'
        : `${m.targetCount} Targets / ${m.distanceGoal} m`;
    document.getElementById('brief-time').textContent = m.timeLimit > 0 ? `${m.timeLimit}s` : 'Unlimited';
    document.getElementById('brief-reward').textContent = m.rewardCoins > 0 ? `${m.rewardCoins} Coins` : 'Distance Bonus';
    document.getElementById('screen-briefing').classList.add('active');
    this.state = 'BRIEFING';
  }

  _renderLevelsModal() {
    const grid = document.getElementById('levels-grid');
    grid.innerHTML = '';
    MISSIONS.forEach((m) => {
      const unlocked = m.id === 7 || m.id <= this.saveData.unlockedMission;
      const stars = this.saveData.stars[m.id] || 0;
      const card = document.createElement('div');
      card.className = `level-card ${unlocked ? '' : 'locked'}`;
      card.innerHTML = `
        <h4>${m.code}: ${m.title}</h4>
        <p>${m.description}</p>
        <div class="level-meta">
          <span>${m.id === 7 ? '∞ ENDLESS' : '★'.repeat(stars) + '☆'.repeat(3 - stars)}</span>
          <span>🪙 ${m.rewardCoins || '∞'}</span>
        </div>
        <button class="gk-btn ${unlocked ? 'primary' : ''}" ${unlocked ? '' : 'disabled'}>
          ${unlocked ? 'SELECT' : 'LOCKED'}
        </button>
      `;
      if (unlocked) {
        card.querySelector('button').addEventListener('click', () => this._openBriefing(m.id));
      }
      grid.appendChild(card);
    });
  }

  _renderGarageModal() {
    document.getElementById('garage-coins-val').textContent = this.saveData.coins;
    const grid = document.getElementById('garage-upgrades');
    grid.innerHTML = '';

    const defs = [
      { key: 'topSpeed', label: 'Top Speed Engine', desc: '+5 km/h max velocity per tier' },
      { key: 'nitroCap', label: 'Nitro Hell Tank', desc: '+25 Nitro capacity per tier' },
      { key: 'chainPower', label: 'Chain Strike Power', desc: '+20 Hellfire damage per tier' }
    ];

    defs.forEach((d) => {
      const lvl = this.saveData.upgrades[d.key];
      const cost = lvl * 200;
      const maxed = lvl >= 5;
      const card = document.createElement('div');
      card.className = 'upgrade-card';
      card.innerHTML = `
        <strong>${d.label} (Lv ${lvl}/5)</strong>
        <small style="color:var(--text-muted)">${d.desc}</small>
        <button class="gk-btn ${!maxed && this.saveData.coins >= cost ? 'primary' : ''}" ${maxed ? 'disabled' : ''}>
          ${maxed ? 'MAXED' : `UPGRADE (🪙 ${cost})`}
        </button>
      `;
      if (!maxed) {
        card.querySelector('button').addEventListener('click', () => {
          if (this.saveData.coins < cost) return;
          this.saveData.coins -= cost;
          this.saveData.upgrades[d.key] += 1;
          this._persistSave();
          this.sound.playPickup();
          this._refreshMenuStats();
          this._renderGarageModal();
        });
      }
      grid.appendChild(card);
    });

    const skinsRow = document.getElementById('garage-skins');
    skinsRow.innerHTML = '';
    Object.values(FLAME_SKINS).forEach((sk) => {
      const owned = this.saveData.unlockedSkins.includes(sk.id);
      const selected = this.saveData.selectedSkin === sk.id;
      const btn = document.createElement('button');
      btn.className = `skin-chip ${selected ? 'selected' : ''}`;
      btn.textContent = selected ? `✓ ${sk.name}` : owned ? sk.name : `${sk.name} (🪙 ${sk.cost})`;
      btn.addEventListener('click', () => {
        if (!owned) {
          if (this.saveData.coins < sk.cost) return;
          this.saveData.coins -= sk.cost;
          this.saveData.unlockedSkins.push(sk.id);
        }
        this.saveData.selectedSkin = sk.id;
        this._persistSave();
        this.sound.playPickup();
        this._refreshMenuStats();
        this._renderGarageModal();
        if (this.state === 'MENU') this._buildShowcaseBackdrop();
      });
      skinsRow.appendChild(btn);
    });
  }

  _refreshMenuStats() {
    const cleared = Object.keys(this.saveData.stars).length;
    document.getElementById('menu-coins').textContent = this.saveData.coins;
    document.getElementById('menu-cleared').textContent = `${cleared} / 6`;
    document.getElementById('menu-endless').textContent = `${this.saveData.endlessBest || 0} m`;
  }

  _togglePause() {
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
      this.sound.updateEngine(0, false, false);
      document.getElementById('screen-pause').classList.add('active');
    } else if (this.state === 'PAUSED') {
      this._hideAllModals();
      this.state = 'PLAYING';
    }
  }

  _bindUI() {
    const gestureUnlock = () => this.sound.initOnGesture();

    document.getElementById('btn-play-next').addEventListener('click', () => {
      gestureUnlock();
      this._openBriefing(this.saveData.unlockedMission);
    });

    document.getElementById('btn-level-select').addEventListener('click', () => {
      gestureUnlock();
      this._hideAllModals();
      this._renderLevelsModal();
      document.getElementById('screen-levels').classList.add('active');
    });

    document.getElementById('btn-garage').addEventListener('click', () => {
      gestureUnlock();
      this._hideAllModals();
      this._renderGarageModal();
      document.getElementById('screen-garage').classList.add('active');
    });

    document.getElementById('btn-how-to-play').addEventListener('click', () => {
      gestureUnlock();
      this._hideAllModals();
      document.getElementById('screen-help').classList.add('active');
    });

    document.querySelectorAll('.close-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._hideAllModals();
        if (this.state === 'MENU' || this.state === 'BRIEFING') {
          this.state = 'MENU';
          document.getElementById('screen-title').classList.add('active');
        }
      });
    });

    document.getElementById('btn-launch-mission').addEventListener('click', () => {
      gestureUnlock();
      this.startMission(this.pendingMissionId || 1);
    });

    document.getElementById('btn-pause').addEventListener('click', () => this._togglePause());
    document.getElementById('btn-resume').addEventListener('click', () => this._togglePause());
    document.getElementById('btn-restart').addEventListener('click', () => this.startMission(this.currentMission.id));

    document.getElementById('btn-pause-levels').addEventListener('click', () => {
      this._hideAllModals();
      document.getElementById('hud').classList.add('hidden');
      this._renderLevelsModal();
      document.getElementById('screen-levels').classList.add('active');
      this.state = 'MENU';
    });

    const goMenu = () => {
      this._hideAllModals();
      document.getElementById('hud').classList.add('hidden');
      this.state = 'MENU';
      this._buildShowcaseBackdrop();
      document.getElementById('screen-title').classList.add('active');
    };
    document.getElementById('btn-pause-menu').addEventListener('click', goMenu);
    document.getElementById('btn-summary-menu').addEventListener('click', goMenu);
    document.getElementById('btn-summary-replay').addEventListener('click', () => this.startMission(this.currentMission.id));
    document.getElementById('btn-summary-next').addEventListener('click', () =>
      this._openBriefing(Math.min(6, this.currentMission.id + 1))
    );

    const syncSoundBtn = () => {
      const muted = this.sound.toggleMute();
      document.getElementById('btn-hud-sound').textContent = muted ? '🔇' : '🔊';
      document.getElementById('btn-pause-audio').textContent = muted ? '🔇 AUDIO: OFF' : '🔊 AUDIO: ON';
    };
    document.getElementById('btn-hud-sound').addEventListener('click', syncSoundBtn);
    document.getElementById('btn-pause-audio').addEventListener('click', syncSoundBtn);

    document.getElementById('btn-hud-boost-info').addEventListener('click', () => {
      if (this.state === 'PLAYING') {
        this._showToast(`NITRO: ${Math.round(this.run.nitro)} / ${this.stats.nitroMax} (HOLD SHIFT)`);
      }
    });

    document.getElementById('btn-hud-help').addEventListener('click', () => {
      this._showToast(this.currentMission.description.slice(0, 68) + '...');
    });

    document.getElementById('btn-open-garage-hud').addEventListener('click', () => {
      if (this.state === 'PLAYING') this._togglePause();
      this._hideAllModals();
      document.getElementById('hud').classList.add('hidden');
      this._renderGarageModal();
      document.getElementById('screen-garage').classList.add('active');
      this.state = 'MENU';
    });

    const cycleCam = () => {
      this.cameraMode = (this.cameraMode + 1) % 3;
      const names = ['CHASE CAM', 'ACTION ANGLE', 'TACTICAL TOP'];
      this._showToast(`CAMERA: ${names[this.cameraMode]}`);
    };
    document.getElementById('btn-camera').addEventListener('click', cycleCam);
    document.getElementById('btn-cam-left').addEventListener('click', cycleCam);

    document.getElementById('btn-bloom-toggle').addEventListener('click', () => {
      this.bloomEnabled = !this.bloomEnabled;
      this._showToast(`BLOOM GLOW: ${this.bloomEnabled ? 'ON' : 'OFF'}`);
    });
  }

  _bindInputs() {
    window.addEventListener('keydown', (e) => {
      this.sound.initOnGesture();
      this.input.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        this.triggerChainAttack();
      } else if (e.code === 'KeyE') {
        this.triggerJump();
      } else if (e.code === 'KeyC') {
        document.getElementById('btn-camera').click();
      } else if (e.code === 'Escape') {
        if (this.state === 'PLAYING' || this.state === 'PAUSED') this._togglePause();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.input.keys.delete(e.code);
    });

    this.renderer.domElement.addEventListener('pointerdown', () => {
      this.sound.initOnGesture();
      if (this.state === 'PLAYING') this.triggerChainAttack();
    });

    const attackBtn = document.getElementById('btn-attack');
    attackBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.sound.initOnGesture();
      this.triggerChainAttack();
    });

    const jumpBtn = document.getElementById('btn-jump');
    jumpBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.sound.initOnGesture();
      this.triggerJump();
    });

    const boostBtn = document.getElementById('btn-boost');
    boostBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.sound.initOnGesture();
      this.input.boost = true;
    });
    const endBoost = () => {
      this.input.boost = false;
    };
    boostBtn.addEventListener('pointerup', endBoost);
    boostBtn.addEventListener('pointercancel', endBoost);
    boostBtn.addEventListener('pointerleave', endBoost);

    const brakeBtn = document.getElementById('btn-brake-touch');
    brakeBtn.addEventListener('pointerdown', () => this.input.keys.add('KeyS'));
    brakeBtn.addEventListener('pointerup', () => this.input.keys.delete('KeyS'));
    brakeBtn.addEventListener('pointercancel', () => this.input.keys.delete('KeyS'));

    const joyZone = document.getElementById('joystick-zone');
    const joyKnob = document.getElementById('joystick-knob');
    const maxRadius = 34;

    const updateJoystick = (clientX, clientY) => {
      const rect = joyZone.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }
      joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.input.joyX = dx / maxRadius;
      this.input.joyY = dy / maxRadius;
    };

    joyZone.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.sound.initOnGesture();
      this.input.joyActive = true;
      this.input.joyPointerId = e.pointerId;
      joyZone.setPointerCapture(e.pointerId);
      updateJoystick(e.clientX, e.clientY);
    });

    joyZone.addEventListener('pointermove', (e) => {
      if (!this.input.joyActive || e.pointerId !== this.input.joyPointerId) return;
      updateJoystick(e.clientX, e.clientY);
    });

    const resetJoystick = (e) => {
      if (e.pointerId !== this.input.joyPointerId) return;
      this.input.joyActive = false;
      this.input.joyPointerId = null;
      this.input.joyX = 0;
      this.input.joyY = 0;
      joyKnob.style.transform = 'translate(0px, 0px)';
    };
    joyZone.addEventListener('pointerup', resetJoystick);
    joyZone.addEventListener('pointercancel', resetJoystick);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new HellfireRiderGame();
});
