import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export const FLAME_SKINS = {
  hellfire: {
    id: 'hellfire',
    name: 'Hellfire Orange',
    cost: 0,
    flamePrimary: 0xff5a00,
    flameCore: 0xffd040,
    bikeAccent: 0xff4500,
    lightColor: 0xff6a1a
  },
  spectral: {
    id: 'spectral',
    name: 'Spectral Cyan',
    cost: 450,
    flamePrimary: 0x00d9ff,
    flameCore: 0xb8ffff,
    bikeAccent: 0x00a8ff,
    lightColor: 0x22e3ff
  },
  crimson: {
    id: 'crimson',
    name: 'Blood Abyss',
    cost: 750,
    flamePrimary: 0xd90429,
    flameCore: 0xff758f,
    bikeAccent: 0xff0033,
    lightColor: 0xff1e42
  }
};

export const EXTERNAL_MODEL_SLOTS = {
  rider: 'assets/models/rider_character.glb',
  chopper: 'assets/models/hell_chopper_bike.glb',
  dragonBoss: 'assets/models/enemies_and_boss.glb',
  envProps: 'assets/models/environment_props.glb'
};

export class AssetManager {
  constructor() {
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath(
      'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/draco/'
    );
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    this.cache = new Map();
  }

  async tryLoadGLB(url) {
    if (!url) return null;
    if (this.cache.has(url)) return this.cache.get(url);
    try {
      const gltf = await new Promise((resolve, reject) => {
        this.gltfLoader.load(url, resolve, undefined, reject);
      });
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      this.cache.set(url, gltf);
      return gltf;
    } catch {
      this.cache.set(url, null);
      return null;
    }
  }

  async preloadOptionalSlots() {
    await Promise.allSettled([
      this.tryLoadGLB(EXTERNAL_MODEL_SLOTS.rider),
      this.tryLoadGLB(EXTERNAL_MODEL_SLOTS.chopper),
      this.tryLoadGLB(EXTERNAL_MODEL_SLOTS.dragonBoss),
      this.tryLoadGLB(EXTERNAL_MODEL_SLOTS.envProps)
    ]);
  }

  createRiderAndBike(skinId = 'hellfire') {
    const skin = FLAME_SKINS[skinId] || FLAME_SKINS.hellfire;
    const root = new THREE.Group();
    const tiltGroup = new THREE.Group();
    root.add(tiltGroup);

    const chopperGltf = this.cache.get(EXTERNAL_MODEL_SLOTS.chopper);
    const riderGltf = this.cache.get(EXTERNAL_MODEL_SLOTS.rider);

    let frontWheel = null;
    let rearWheel = null;
    const skullFlameAnchor = new THREE.Vector3(0, 2.02, -0.1);
    const rearFlameAnchor = new THREE.Vector3(0, 0.52, 1.35);

    if (chopperGltf && chopperGltf.scene) {
      const bikeMesh = chopperGltf.scene.clone();
      tiltGroup.add(bikeMesh);
    } else {
      const builtBike = this._buildProceduralChopper(skin);
      tiltGroup.add(builtBike.group);
      frontWheel = builtBike.frontWheel;
      rearWheel = builtBike.rearWheel;
    }

    let riderAnimMixer = null;
    let riderRig = null;
    if (riderGltf && riderGltf.scene) {
      const riderMesh = riderGltf.scene.clone();
      riderMesh.position.set(0, 0.72, 0.15);
      tiltGroup.add(riderMesh);
      if (riderGltf.animations && riderGltf.animations.length > 0) {
        riderAnimMixer = new THREE.AnimationMixer(riderMesh);
        riderAnimMixer.clipAction(riderGltf.animations[0]).play();
      }
    } else {
      riderRig = this._buildProceduralRider(skin);
      tiltGroup.add(riderRig.group);
    }

    const skullLight = new THREE.PointLight(skin.lightColor, 6.5, 13, 1.8);
    skullLight.position.copy(skullFlameAnchor);
    tiltGroup.add(skullLight);

    const wheelLight = new THREE.PointLight(skin.lightColor, 5.0, 11, 1.8);
    wheelLight.position.set(0, 0.55, 0.2);
    tiltGroup.add(wheelLight);

    return {
      root,
      tiltGroup,
      frontWheel,
      rearWheel,
      riderRig,
      riderAnimMixer,
      skullLight,
      wheelLight,
      anchors: {
        skull: skullFlameAnchor,
        rear: rearFlameAnchor
      }
    };
  }

  _buildProceduralChopper(skin) {
    const group = new THREE.Group();

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xc5cbd6,
      metalness: 0.9,
      roughness: 0.22
    });
    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x181a22,
      metalness: 0.72,
      roughness: 0.42
    });
    const tankMat = new THREE.MeshStandardMaterial({
      color: 0x101016,
      metalness: 0.65,
      roughness: 0.28
    });
    const fireRimMat = new THREE.MeshStandardMaterial({
      color: skin.flamePrimary,
      emissive: skin.flamePrimary,
      emissiveIntensity: 2.2,
      roughness: 0.3
    });
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x121216,
      roughness: 0.85
    });

    const createWheel = (radius, width) => {
      const wGroup = new THREE.Group();
      const tire = new THREE.Mesh(
        new THREE.TorusGeometry(radius, width * 0.46, 12, 24),
        tireMat
      );
      tire.rotation.y = Math.PI / 2;
      tire.castShadow = true;
      wGroup.add(tire);

      const fireRing = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.88, 0.045, 8, 24),
        fireRimMat
      );
      fireRing.rotation.y = Math.PI / 2;
      wGroup.add(fireRing);

      for (let i = 0; i < 6; i++) {
        const spoke = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.02, radius * 1.65, 6),
          chromeMat
        );
        spoke.rotation.x = (i * Math.PI) / 6;
        wGroup.add(spoke);
      }
      return wGroup;
    };

    const frontWheel = createWheel(0.46, 0.22);
    frontWheel.position.set(0, 0.48, -1.42);
    group.add(frontWheel);

    const rearWheel = createWheel(0.5, 0.38);
    rearWheel.position.set(0, 0.52, 1.24);
    group.add(rearWheel);

    for (const side of [-0.14, 0.14]) {
      const fork = new THREE.Mesh(
        new THREE.CylinderGeometry(0.036, 0.032, 1.48, 8),
        chromeMat
      );
      fork.position.set(side, 0.96, -1.04);
      fork.rotation.x = -0.58;
      group.add(fork);
    }

    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.92, 8),
      chromeMat
    );
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 1.48, -0.54);
    group.add(bar);

    const cowl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), chromeMat);
    cowl.position.set(0, 1.15, -0.96);
    group.add(cowl);

    const headlight = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd782 })
    );
    headlight.rotation.x = Math.PI / 2;
    headlight.position.set(0, 1.12, -1.08);
    group.add(headlight);

    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.28, 6), chromeMat);
      horn.position.set(side * 0.16, 1.24, -0.95);
      horn.rotation.z = -side * 0.7;
      horn.rotation.x = -0.3;
      group.add(horn);
    }

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 1.9), darkMetalMat);
    frame.position.set(0, 0.62, 0.1);
    group.add(frame);

    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.85), tankMat);
    tank.position.set(0, 1.05, -0.3);
    tank.rotation.x = 0.2;
    tank.castShadow = true;
    group.add(tank);

    for (const angle of [-0.32, 0.32]) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.42, 8), chromeMat);
      cyl.position.set(0, 0.68, -0.15);
      cyl.rotation.x = angle;
      group.add(cyl);
    }

    for (const side of [-0.26, 0.26]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.45, 8), chromeMat);
      pipe.rotation.x = Math.PI / 2 - 0.06;
      pipe.position.set(side, 0.48, 0.56);
      group.add(pipe);
    }

    const fender = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.82), tankMat);
    fender.position.set(0, 0.96, 1.18);
    fender.rotation.x = -0.25;
    group.add(fender);

    const crossMat = new THREE.MeshBasicMaterial({ color: skin.flameCore });
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.06), crossMat);
    crossV.position.set(0.24, 0.72, 1.15);
    group.add(crossV);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.22), crossMat);
    crossH.position.set(0.24, 0.72, 1.15);
    group.add(crossH);

    return { group, frontWheel, rearWheel };
  }

  _buildProceduralRider(skin) {
    const group = new THREE.Group();
    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0x161419,
      roughness: 0.45,
      metalness: 0.2
    });
    const jeansMat = new THREE.MeshStandardMaterial({
      color: 0x1c222e,
      roughness: 0.8
    });
    const skullMat = new THREE.MeshStandardMaterial({
      color: 0xf4e8d4,
      emissive: skin.flamePrimary,
      emissiveIntensity: 0.55,
      roughness: 0.35
    });
    const chainMat = new THREE.MeshStandardMaterial({
      color: 0xd0d5dd,
      emissive: skin.flameCore,
      emissiveIntensity: 0.4,
      metalness: 0.9,
      roughness: 0.2
    });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.68, 0.32), leatherMat);
    torso.position.set(0, 1.38, 0.18);
    torso.rotation.x = -0.35;
    torso.castShadow = true;
    group.add(torso);

    const chainStrap = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.08, 0.35), chainMat);
    chainStrap.position.set(0, 1.4, 0.18);
    chainStrap.rotation.z = 0.65;
    chainStrap.rotation.x = -0.35;
    group.add(chainStrap);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.84, 0.02);
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), skullMat);
    headGroup.add(cranium);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.18), skullMat);
    jaw.position.set(0, -0.1, -0.04);
    headGroup.add(jaw);

    const eyeMat = new THREE.MeshBasicMaterial({ color: skin.flameCore });
    for (const side of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 6), eyeMat);
      eye.position.set(side, 0.01, -0.155);
      headGroup.add(eye);
    }
    group.add(headGroup);

    const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.68, 8), leatherMat);
    leftArm.position.set(-0.29, 1.48, -0.18);
    leftArm.rotation.x = 1.1;
    leftArm.rotation.z = -0.25;
    group.add(leftArm);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.28, 1.56, 0.08);
    const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.68, 8), leatherMat);
    rightArm.position.set(0.02, -0.08, -0.26);
    rightArm.rotation.x = 1.1;
    rightArmPivot.add(rightArm);
    group.add(rightArmPivot);

    for (const side of [-0.24, 0.24]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.075, 0.68, 8), jeansMat);
      leg.position.set(side, 0.88, 0.05);
      leg.rotation.x = -0.55;
      leg.rotation.z = side > 0 ? -0.25 : 0.25;
      group.add(leg);
    }

    return { group, headGroup, rightArmPivot };
  }

  createDragonBoss() {
    const dragonGltf = this.cache.get(EXTERNAL_MODEL_SLOTS.dragonBoss);
    const root = new THREE.Group();

    if (dragonGltf && dragonGltf.scene) {
      const clone = dragonGltf.scene.clone();
      clone.scale.setScalar(2.4);
      root.add(clone);
      return { root, leftWing: null, rightWing: null };
    }

    const scaleMat = new THREE.MeshStandardMaterial({
      color: 0x6a1b2e,
      emissive: 0x380814,
      emissiveIntensity: 0.6,
      roughness: 0.45
    });
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x3b0d1b,
      emissive: 0x991b1b,
      emissiveIntensity: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.6
    });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffae00 });

    const body = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.4, 8), scaleMat);
    body.rotation.x = Math.PI / 2;
    root.add(body);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, 2.2, 8), scaleMat);
    neck.position.set(0, 0.7, 2.2);
    neck.rotation.x = 0.65;
    root.add(neck);

    const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.5), scaleMat);
    head.position.set(0, 1.45, 3.25);
    root.add(head);

    for (const s of [-0.35, 0.35]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), glowMat);
      eye.position.set(s, 1.62, 3.85);
      root.add(eye);
    }

    const makeWing = (dir) => {
      const pivot = new THREE.Group();
      pivot.position.set(dir * 0.85, 0.3, 0.2);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.1, 2.3), wingMat);
      blade.position.set(dir * 2.4, 0, -0.2);
      pivot.add(blade);
      root.add(pivot);
      return pivot;
    };

    const leftWing = makeWing(-1);
    const rightWing = makeWing(1);

    const rider = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 1.2, 0.65),
      new THREE.MeshStandardMaterial({ color: 0x161624, metalness: 0.8, roughness: 0.3 })
    );
    rider.position.set(0, 1.15, 0.2);
    root.add(rider);

    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.16), glowMat);
    sword.position.set(0.55, 1.85, 0.5);
    sword.rotation.z = -0.45;
    root.add(sword);

    const bossLight = new THREE.PointLight(0xff4400, 10, 26);
    bossLight.position.set(0, 1.5, 3.8);
    root.add(bossLight);

    return { root, leftWing, rightWing };
  }

  createSwingingAxe(bridgeWidth) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 8.6, 0);

    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x262830,
      metalness: 0.85,
      roughness: 0.35
    });
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0xff6a00,
      emissive: 0xff4500,
      emissiveIntensity: 2.0
    });

    const chainRod = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 7.2, 8), ironMat);
    chainRod.position.y = -3.6;
    pivot.add(chainRod);

    const bladeHead = new THREE.Group();
    bladeHead.position.y = -7.0;

    const core = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.5), ironMat);
    bladeHead.add(core);

    for (const dir of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 0.2), edgeMat);
      wing.position.x = dir * 1.05;
      bladeHead.add(wing);
    }

    pivot.add(bladeHead);
    pivot.userData.halfSpan = Math.min(bridgeWidth * 0.42, 4.5);
    return pivot;
  }

  createCursedTarget(type = 'totem') {
    const group = new THREE.Group();
    if (type === 'biker') {
      const hull = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 1.4, 2.4),
        new THREE.MeshStandardMaterial({ color: 0x191826, metalness: 0.7, roughness: 0.4 })
      );
      hull.position.y = 0.8;
      group.add(hull);
      const skull = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 8, 8),
        new THREE.MeshStandardMaterial({
          color: 0xd0d0e0,
          emissive: 0x8b00ff,
          emissiveIntensity: 1.4
        })
      );
      skull.position.set(0, 1.75, 0);
      group.add(skull);
    } else {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.65, 2.4, 8),
        new THREE.MeshStandardMaterial({ color: 0x2a2433, roughness: 0.85 })
      );
      pillar.position.y = 1.2;
      group.add(pillar);
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.62, 0),
        new THREE.MeshStandardMaterial({
          color: 0xbc2bff,
          emissive: 0x9d00ff,
          emissiveIntensity: 2.2
        })
      );
      crystal.position.y = 2.85;
      group.add(crystal);
    }
    return group;
  }

  createOrb(colorHex = 0x22d3ee) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 14, 14),
      new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 2.2,
        roughness: 0.2
      })
    );
    mesh.position.y = 1.25;
    return mesh;
  }

  createBarricade() {
    const group = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 1.15, 0.75),
      new THREE.MeshStandardMaterial({
        color: 0x3b2316,
        emissive: 0x661100,
        emissiveIntensity: 0.6,
        roughness: 0.75
      })
    );
    beam.position.y = 0.6;
    beam.castShadow = true;
    group.add(beam);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(2.85, 0.25, 0.8),
      new THREE.MeshBasicMaterial({ color: 0xff5500 })
    );
    stripe.position.y = 0.9;
    group.add(stripe);
    return group;
  }

  createFireTrap() {
    const group = new THREE.Group();
    const grate = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.3, 0.18, 10),
      new THREE.MeshStandardMaterial({ color: 0x2b1d1b, roughness: 0.8 })
    );
    grate.position.y = 0.09;
    group.add(grate);

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 2.5, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5e00, transparent: true, opacity: 0.85 })
    );
    flame.position.y = 1.3;
    group.add(flame);
    return group;
  }

  createBoostPad() {
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.08, 4.2),
      new THREE.MeshBasicMaterial({ color: 0xffcc00 })
    );
    pad.position.y = 0.05;
    return pad;
  }

  createRamp() {
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.35, 5.2),
      new THREE.MeshStandardMaterial({
        color: 0x2d2a38,
        emissive: 0xff6600,
        emissiveIntensity: 0.55,
        roughness: 0.6
      })
    );
    ramp.rotation.x = 0.24;
    ramp.position.y = 0.55;
    return ramp;
  }

  createRuinedArch(width = 12) {
    const group = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2f2b38, roughness: 0.9 });
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });

    for (const s of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(1.5, 8.2, 1.5), stoneMat);
      col.position.set(s * (width * 0.52), 4.1, 0);
      col.castShadow = true;
      group.add(col);

      const torch = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), emberMat);
      torch.position.set(s * (width * 0.52), 8.4, 0);
      group.add(torch);
    }

    const lintel = new THREE.Mesh(new THREE.BoxGeometry(width + 3.0, 1.4, 1.6), stoneMat);
    lintel.position.set(0, 8.4, 0);
    group.add(lintel);

    return group;
  }

  dispose() {
    this.dracoLoader.dispose();
  }
}
