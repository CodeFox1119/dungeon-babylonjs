import utils from './Utils.js'
import { MeshAndActorManager } from './MeshAndActorManager.js'

let Dungeon = function (canvas) {
  this.enableswing = true;
  this.movementX = 0 // mouse left/right
  this.movementY = 0 // mouse up/down
  this.agentsReadyToInitialize = false;
  this.agentsInitialized = false;
  this.totalAgentsSoFar = []; // list of total agents so they can be added via addToCrowdAI after the agents are loaded and ready to initialize 
  this.enemyAgents = []; // current active enemy agents
  this.lastPointerUnlockTS = 0;

  this.engine = new BABYLON.Engine(canvas, true);
  this.engine.loadingScreen = this.initLoadingScreen();

  // Resize window event
  let _this = this;
  window.addEventListener("resize", function () {
    _this.engine.resize();
  });

  this.scene = new BABYLON.Scene(this.engine);
  console.log(BABYLON.ScenePerformancePriority);
  // doesn't seem to be available in 5.22
  // this.scene.performancePriority = BABYLON.ScenePerformancePriority.Aggressive; // try to optimize for mobile
  this.scene.skipPointerMovePicking = true; //  so do the optimizations manually
  this.scene.autoClear = false; // Color buffer
  this.scene.autoClearDepthAndStencil = false; // Depth and stencil, obviously
  this.scene.skipFrustumClipping = true;
  // console.log(utils.isTouchEnabled() || utils.getWindowWidth() < 768);
  // this.prepNavmeshCreator(); // prepare navmesh creator by loading recast wasm


  this.TAU = 2 * Math.PI;
  this.PI = Math.PI;
  this.PI0125 = Math.PI / 8;
  this.PI06125 = Math.PI / 16;

  const camera = this.createCamera();
  // limit camera rotation in up/down directions
  camera.onAfterCheckInputsObservable.add(() => {
    if (utils.isTouchEnabled()) {
      camera.rotation.x = 0; // don't allow up/down at all on mobile (since too confusing)
    }
    else {
      if (camera.rotation.x > this.PI06125) {
        camera.rotation.x = this.PI06125;
      }
      else if (camera.rotation.x < -this.PI06125) {
        camera.rotation.x = -this.PI06125;
      }
    }
  });

  // Targets the camera to a particular position. In this case the scene origin
  camera.setTarget(BABYLON.Vector3.Zero());
  _this.freeFloorTilePositions = [];

  _this.initScene();

  _this.meshAndActorManager = new MeshAndActorManager();
  _this.meshAndActorManager.initNewLevel();
  _this.actorsOnCurrentLevel = ["deathknight", "deathknight", "deathknight"]

  this.scene.executeWhenReady(async function () {
    _this.engine.loadingScreen.hideLoadingUI();
    _this.importSword(_this.scene, camera);
    for (let i = 0; i < _this.actorsOnCurrentLevel.length; i++) {
      let positionIndex = Math.floor(Math.random() * _this.freeFloorTilePositions.length);
      let position = _this.freeFloorTilePositions[positionIndex];
      await _this.meshAndActorManager.addActor(position, _this.actorsOnCurrentLevel[i], _this.scene, _this);

      // remove it from the free tile list so another monster doesn't spawn on the same spot
      _this.freeFloorTilePositions.splice(positionIndex, 1); // 2nd parameter means remove one item only
    }

    //        _this.importMesh(_this.scene, _this); // import all monster types/items/doors etc in the background (so likely use gltf)
    _this.createNavmesh();

    _this.engine.runRenderLoop(function () {
      _this.update(_this);
    });
  });
  return;
};

Dungeon.prototype.createNavmesh = function () {
  let navmeshParameters = {
    cs: .5,
    ch: .2,
    walkableSlopeAngle: 0,
    walkableHeight: 0.0,
    walkableClimb: 0,
    walkableRadius: 1,
    maxEdgeLen: 12.,
    maxSimplificationError: 1.3,
    minRegionArea: 8,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 15,
    // doesn't seem to work with or without obstacles --\/
    borderSize: 1, // for obstacles as per https://doc.babylonjs.com/extensions/crowdNavigation/obstacles
    tileSize: 20
  };

  /*    console.log("mesh array");
      console.log(this.meshesForNavMeshCalc); */
  if (!this.navPlugin) {
    this.prepNavmeshCreator().then((navMeshPlugin) => {
      if (navMeshPlugin) {
        let startTime = Date.now();
        this.navPlugin.createNavMesh(this.meshesForNavMeshCalc, navmeshParameters);
        let endTime = Date.now();
        console.log("Time to produce navmesh:" + (endTime - startTime) + "ms");
        this.showDebugMesh();
        this.initAI();
      }
    })
  }
  else {
    this.navPlugin.createNavMesh(this.meshesForNavMeshCalc, navmeshParameters);
    this.showDebugMesh();
    this.initAI();
  }
}

// https://forum.babylonjs.com/t/error-after-updating-to-alpha-40-updated-recast-js/23513/2
Dungeon.prototype.prepNavmeshCreator = async function () {
  if (!this.navPlugin) {
    await Recast();
    console.log('recast loaded');
    this.navPlugin = new BABYLON.RecastJSPlugin();
    console.log('nav plugin loaded');
    return this.navPlugin;
    //    console.log(this.navPlugin);
  }
}

Dungeon.prototype.showDebugMesh = function () {
  let navmeshdebug = this.navPlugin.createDebugNavMesh(this.scene);
  navmeshdebug.position = new BABYLON.Vector3(0, 0.01, 0);

  let matdebug = new BABYLON.StandardMaterial('matdebug', this.scene);
  matdebug.diffuseColor = new BABYLON.Color3(0.1, 0.2, 1);
  matdebug.alpha = 0.2;
  navmeshdebug.material = matdebug;
}

Dungeon.prototype.initAI = function () {
  let MAX_ENEMIES = 10;
  this.crowd = this.navPlugin.createCrowd(MAX_ENEMIES, 3.6, this.scene);
  this.crowd.onReachTargetObservable.add((agentInfos) => {
    console.log("agent #" + agentInfos.agentIndex + " reached destination");
  });

}

const ACTORSTATE = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  WALKING: 'WALKING',
  ATTACKING: 'ATTACKING'
};

Dungeon.prototype.addToCrowdAI = function (containerToAdd) {
  let i;
  let agentParams = {
    radius: 2,
    height: 7.2,
    maxAcceleration: 1000,
    maxSpeed: 10.0,
    collisionQueryRange: 9,
    pathOptimizationRange: 0.0,
    separationWeight: 1
  };

  //newMeshes[i].position = new BABYLON.Vector3(0, 1.1, 10);
  //    let positionToUse = this.navPlugin.getClosestPoint(new BABYLON.Vector3(3.0, 0, 10.0));
  let positionToUse = this.navPlugin.getClosestPoint(new BABYLON.Vector3(
    containerToAdd.rootNodes[0].position.x, 0, containerToAdd.rootNodes[0].position.z));
  //    let positionToUse = this.navPlugin.getClosestPoint(new BABYLON.Vector3(0, 0, 0));
  /*    let transform = new BABYLON.TransformNode();
      meshToAdd.parent = transform;
      let agentIndex = this.crowd.addAgent(positionToUse, agentParams, transform);
      this.enemyAgents.push({idx:agentIndex, trf:transform, mesh:meshToAdd, target:null}); */

  // just use mesh itself as transform node (otherwise the position is offset, and setting the transform node to the same positoin as the parent mesh doesn't seem to help)
  let agentIndex = this.crowd.addAgent(positionToUse, agentParams, containerToAdd.rootNodes[0]);
  // containerToAdd.rootNodes[0].checkCollisions = true;
  // // root.showBoundingBox = true;
  // containerToAdd.rootNodes[0].actionManager = new BABYLON.ActionManager(this.scene);
  // var actionParameter = { trigger: BABYLON.ActionManager.OnIntersectionEnterTrigger, parameter: this.sword };
  // containerToAdd.rootNodes[0].actionManager.registerAction(new BABYLON.ExecuteCodeAction(actionParameter, function (event) {
  //   console.log("Hit=====================!");
  // }));
  this.enemyAgents.push({
    idx: agentIndex, state: ACTORSTATE.IDLE, trf: containerToAdd.rootNodes[0], mesh: containerToAdd.rootNodes[0],
    animGrps: containerToAdd.animationGroups, target: null
  });

  // default AI (should wander first, then approach player when within certain distance)
  //    let camera = this.scene.activeCamera
  //    this.crowd.agentGoto(agentIndex, this.navPlugin.getClosestPoint(camera.position));

}

Dungeon.prototype.createCamera = function () {
  let camera;
  if (utils.isTouchEnabled()) {
    camera = new BABYLON.VirtualJoysticksCamera("vrCam", new BABYLON.Vector3(0, 1, 0), this.scene);

    //        camera.applyGravity = true;
    //      camera.ellipsoid = new BABYLON.Vector3(2, 1, 2); // the player size -- https://doc.babylonjs.com/divingDeeper/cameras/camera_collisions
    //    camera.checkCollisions = true;
    //    camera.position = new BABYLON.Vector3(0, 4, 0);
    //    camera.rotation = new BABYLON.Vector3(0, 0, 0);

    //    scene.onPointerDown = function () {
    //        scene.onPointerDown = undefined
    camera.attachControl(this.canvas, true);
    camera.inputs.attached.virtualJoystick.getLeftJoystick().setJoystickSensibility(0.02);
    //        camera.inputs.attached.virtualJoystick.getLeftJoystick().reverseLeftRight = true;
    camera.inputs.attached.virtualJoystick.getRightJoystick().setJoystickSensibility(0.02);
    //        camera.inputs.attached.virtualJoystick.getRightJoystick().reverseLeftRight = true;
    //    }
  }
  else {
    camera = new BABYLON.UniversalCamera("UniversalCamera", new BABYLON.Vector3(0, 0, -10), this.scene);
    camera.speed = 1;//0.35; // slow down movement speed
  }
  return camera;
};


/* won't really work right unless get pointer lock (since mouse will go to edge of screen and then lose focus and no longer effect the camera rotation)
Dungeon.prototype.onMouseMove = function (event) {
    let camera = this.scene.activeCamera;

    this.movementX = event.movementX * 0.001;
    this.movementY = event.movementY * 0.001;
  
    this.movementY = Math.max(-this.PI0125, Math.min(this.PI0125, this.movementY)); // limit max movement in y direction
  //  this.movementY = Math.max(-PI05, Math.min(PI05, this.movementY))

  console.log("movementx/y:" + event.movementX + "," + this.movementX);  
//  console.log("before:" + camera.rotation.x + ","+ camera.rotation.y+ ","+this.movementX +","+ this.movementY + "," + event.movementX + "," + event.movementY);
  camera.rotation.y += this.movementX; // yaw
  camera.rotation.x += this.movementY; // pitch
//  console.log("after:" + camera.rotation.x + ","+ camera.rotation.y);
}      
*/

Dungeon.prototype.update = function (_this) {
  //    const delta = this.time.update().getDelta()
  //    console.log(delta);

  //this.controls.update(delta)
  //this.entityManager.update(delta)
  if (_this.crowd) { // crowd initialized yet?

    _this.meshAndActorManager.checkInitCrowd(_this);

    // default AI (should wander first, then approach player when within certain distance)
    let camera = _this.scene.activeCamera
    //    this.crowd.agentGoto(agentIndex, this.navPlugin.getClosestPoint(camera.position));
    let agents = _this.crowd.getAgents();
    let i;
    for (i = 0; i < agents.length; i++) {
      // if wandering, target random
      // if seeking, target player camera
      let target = _this.navPlugin.getClosestPoint(new BABYLON.Vector3(camera.position.x, 0, camera.position.z));

      let ag;
      for (let j = 0; j < _this.enemyAgents.length; j++) {
        if (_this.enemyAgents[i].idx == i) { // found our agent?
          ag = _this.enemyAgents[i];
          break;
        }
      }
      if (ag) {
        let a = camera.position.x - ag.mesh.position.x;
        let b = camera.position.z - ag.mesh.position.z;
        let distance = Math.sqrt(a * a + b * b);
        let vel = _this.crowd.getAgentVelocity(i);
        this.armyHealthBar1.position = new BABYLON.Vector3(_this.enemyAgents[0].mesh.position.x, _this.enemyAgents[0].mesh.position.y + 5, _this.enemyAgents[0].mesh.position.z)
        this.armyHealthBar2.position = new BABYLON.Vector3(_this.enemyAgents[1].mesh.position.x, _this.enemyAgents[1].mesh.position.y + 5, _this.enemyAgents[1].mesh.position.z)
        this.armyHealthBar3.position = new BABYLON.Vector3(_this.enemyAgents[2].mesh.position.x, _this.enemyAgents[2].mesh.position.y + 5, _this.enemyAgents[2].mesh.position.z)
        this.armyHealthBar1.rotation = camera.rotation;
        this.armyHealthBar2.rotation = camera.rotation;
        this.armyHealthBar3.rotation = camera.rotation;
        if (distance < 18 && distance > 12 && vel.length() > 4) {

          let theta = Math.atan2(camera.position.x - ag.mesh.position.x, camera.position.z - ag.mesh.position.z);
          theta = theta < 0 ? theta + _this.TAU : theta;
          let diff = ag.mesh.rotation.y - theta;
          diff = diff < -_this.PI ? diff + _this.TAU : diff;

          if (Math.abs(diff) > 0.02) {
            ag.mesh.rotation.y -= 0.04 * Math.sign(diff);

            if (ag.mesh.rotation.y > _this.PI) {
              ag.mesh.rotation.y -= _this.TAU;
            }
            else if (ag.mesh.rotation.y < -_this.PI) {
              ag.mesh.rotation.y += _this.TAU;
            }
          }
          // enemy has arrived at player, so no need to continue approaching
          if (ag.state != ACTORSTATE.WALKING) {
            ag.state = ACTORSTATE.WALKING;
            _this.stopAnimations(ag.animGrps)
            ag.animGrps[3].start(); // walk
            ag.animGrps[3].loopAnimation = true;
          }
        }
        else if (distance > 18) { // approach, and keep rotated toward the player
          ag.reachedDestination = false;

          _this.crowd.agentGoto(agents[i], target);
          if (vel.length() > 0.2 && distance > 24) {
            if (ag.state != ACTORSTATE.RUNNING) {

              ag.state = ACTORSTATE.RUNNING;
              _this.stopAnimations(ag.animGrps)
              ag.animGrps[2].start(); // run
              ag.animGrps[2].loopAnimation = true;
            }

            vel.normalize();
            let desiredRotation = Math.atan2(vel.x, vel.z);
            ag.mesh.rotation.y = ag.mesh.rotation.y + (desiredRotation - ag.mesh.rotation.y) * 0.05;
          }
        } else if (distance < 8) {
          // enemy has arrived at player, so no need to continue approaching
          // can start the attack state machine intead (should be inside Enemy.js)
          if (!ag.reachedDestination) {
            let currentPosition = _this.navPlugin.getClosestPoint(new BABYLON.Vector3(ag.mesh.position.x, 0, ag.mesh.position.z));
            // use teleport to reset agent position so it doesn't keep trying to move once it arrives
            _this.crowd.agentTeleport(agents[i], currentPosition); // maintain current position
            ag.reachedDestination = true;
            if (ag.state != ACTORSTATE.ATTACKING) {
              ag.state = ACTORSTATE.ATTACKING;
              _this.stopAnimations(ag.animGrps)
              ag.animGrps[0].start(); // attack
              ag.animGrps[0].loopAnimation = true;
            }
          }

          // and keep mesh rotation pointed at the camera if the player decides to move around the enemy
          let theta = Math.atan2(camera.position.x - ag.mesh.position.x, camera.position.z - ag.mesh.position.z);
          theta = theta < 0 ? theta + _this.TAU : theta;
          let diff = ag.mesh.rotation.y - theta;
          diff = diff < -_this.PI ? diff + _this.TAU : diff;

          if (Math.abs(diff) > 0.02) {
            ag.mesh.rotation.y -= 0.04 * Math.sign(diff);

            if (ag.mesh.rotation.y > _this.PI) {
              ag.mesh.rotation.y -= _this.TAU;
            }
            else if (ag.mesh.rotation.y < -_this.PI) {
              ag.mesh.rotation.y += _this.TAU;
            }
          }

        }
        else {
          if (ag.state != ACTORSTATE.IDLE) {
            ag.state = ACTORSTATE.IDLE;
            _this.stopAnimations(ag.animGrps)
            ag.animGrps[1].start(); // idle
            ag.animGrps[1].loopAnimation = true;
          }

        }
      }



    }
  }
  _this.scene.render();
  if (_this.fpsText) {
    _this.fpsText.text = "Meshes: " + _this.scene.meshes.length + "; " + _this.engine.getFps().toFixed() + " fps";
  }
  if (this.enableswing) {
    if (this.sword.position._x > -3) {
      // this.sword.movePOV(.5, 0, 0)
    } else {
      this.enableswing = false;
      // this.sword.position = new BABYLON.Vector3(4, -2.5, 5);
    }
  }
}

Dungeon.prototype.stopAnimations = function (animGrps) {
  for (let i = 0; i < animGrps.length; i++) {
    animGrps[i].stop();
  }
}


Dungeon.prototype.importSword = function (scene, camera) {

  // const loadTask = BABYLON.SceneLoader.ImportMeshAsync("", "https://raw.githubusercontent.com/HumbleDev-1119/dungeon-babylonjs/main/assets/meshes/", "deathknight.glb", scene);

  // loadTask.then((result) => {
  //     console.log("Model loaded");
  //     camera.target = result.meshes[0].position;
  //     result.meshes[0].scaling = new BABYLON.Vector3(0.1, 0.1, 0.1);
  //     result.meshes[0].rotate(new BABYLON.Vector3(1, 0, 0), 90);

  //     const handNode = scene.getNodeByName("mixamorig:RightHand");

  //     const swordCollider = BABYLON.MeshBuilder.CreateBox("test_collider", {width: 2, height: 2, depth: 2}, scene);
  //     swordCollider.setParent(handNode, true, true);
  //     swordCollider.position = new BABYLON.Vector3(0, 0, 0);
  //     swordCollider.checkCollisions = true;
  //     swordCollider.actionManager = new BABYLON.ActionManager(scene);

  //     const enemyCollider = BABYLON.MeshBuilder.CreateBox("enemyCollider", {width: 2, height: 10, depth: 2}, scene);
  //     enemyCollider.position = new BABYLON.Vector3(0, 0, -15);
  //     enemyCollider.checkCollisions = true;

  //     var actionParameter = { trigger: BABYLON.ActionManager.OnIntersectionEnterTrigger, parameter: enemyCollider };

  //     swordCollider.actionManager.registerAction(new BABYLON.ExecuteCodeAction(actionParameter, function(event) 
  //     {
  //         console.log("Hit!");
  //     }));
  // });


  // set up our transform node so we can attach the sword to the camera
  let transformNode = new BABYLON.TransformNode();
  transformNode.parent = camera;
  transformNode.position = new BABYLON.Vector3(0.5, -0.7, 0.5);
  transformNode.rotation.x = -0.01;
  camera.fov = 1;

  const swordCollider = BABYLON.MeshBuilder.CreateBox("test_collider", { width: 2, height: 20, depth: 2 }, scene);
  swordCollider.position = new BABYLON.Vector3(0, 0, 0);
  swordCollider.checkCollisions = true;

  BABYLON.SceneLoader.ImportMeshAsync("", "assets/", "longsword.glb", scene,).then(results => {
    let root = results.meshes[1];
    root.name = '__sword__';
    root.id = '__sword__';
    root.ellipsoid = new BABYLON.Vector3(.5, .5, .5);
    root.position = new BABYLON.Vector3(1, -1, 3);
    // root.position = new BABYLON.Vector3(.5, -1, 3);
    // root.rotation = new BABYLON.Vector3(BABYLON.Tools.ToRadians(25), BABYLON.Tools.ToRadians(180), 0);
    // root.position = new BABYLON.Vector3(3, -2.5, 5);
    // root.rotation = new BABYLON.Vector3(1, 1, 1);
    // const handNode = scene.getNodeByName("mixamorig:RightHand");
    // const swordCollider = BABYLON.MeshBuilder.CreateBox("test_collider", {width: 2, height: 2, depth: 2}, scene);
    // swordCollider.setParent(handNode, true, true);
    // swordCollider.position = new BABYLON.Vector3(0, 0, 0);
    // swordCollider.checkCollisions = true;
    // swordCollider.actionManager = new BABYLON.ActionManager(scene);
    root.scaling.scaleInPlace(1);
    // root.setParent(handNode, true, true);
    // root.scaling.scaleInPlace(.5);
    // root.isPickable = true;
    root.checkCollisions = true;//check for collisions
    root.parent = transformNode;
    this.sword = root;
    // this.sword.actionManager = new BABYLON.ActionManager(this.scene);
    // var actionParameter = { trigger: BABYLON.ActionManager.OnIntersectionEnterTrigger, parameter: swordCollider };
    // this.sword.actionManager.registerAction(new BABYLON.ExecuteCodeAction(actionParameter, function (event) {
    //     console.log("Hit!",this.sword);
    // }));
  });
  BABYLON.NodeMaterial.ParseFromSnippetAsync("8HENV8#7", this.scene).then((mat) => {
    this.armyHealthBar1 = BABYLON.MeshBuilder.CreatePlane("armyHealthBar1", { width: 1.5, height: 0.1, sideOrientation: BABYLON.Mesh.DOUBLESIDE });
    this.armyHealthBar1.material = mat.clone("pm");
    this.armyHealthBar1.material.getBlockByName("fillRate").value = 10;
    this.armyHealthBar1.position = new BABYLON.Vector3(1, 1, 1);
    this.armyHealthBar2 = this.armyHealthBar1.clone("armyHeathBar2");
    this.armyHealthBar2.position = new BABYLON.Vector3(1, 1, 1);
    this.armyHealthBar3 = this.armyHealthBar1.clone("armyHeathBar3");
    this.armyHealthBar3.position = new BABYLON.Vector3(1, 1, 1);
  })
}

let isLocked = false;
Dungeon.prototype.initScene = function () {

  // Camera attached to the canvas
  let camera = this.scene.activeCamera;

  //camera.setTarget(new BABYLON.Vector3(0,0,0));
  let canvas = this.engine.getRenderingCanvas();
  camera.attachControl(this.engine.getRenderingCanvas());

  // jump wasn't working, so uncommented the next four lines, then it worked, and when commented out
  // again and cleared cache, it was still working ¯\_(ツ)_/¯
  // Attach the camera to the canvas
  /*    camera.applyGravity = true;
      camera.ellipsoid = new BABYLON.Vector3(1,1.5,1);
      camera.checkCollisions = true;
      camera.attachControl(canvas, true); 
  */
  //    this.initPlayAreaBounds(this.scene);

  this.initSkybox(this.scene);

  this.initControls(this.scene, camera, canvas);

  let reticule = this.initCrosshairs(camera, this.scene);

  this.initLights();

  //    this.initTorches();

  this.initShadows();

  this.initCollisions();

  this.initFx(camera);

  this.initFpsOverlay();

  this.generateWallsAndFloor(this.scene);

};

Dungeon.prototype.setDefaultMaterialColors = function (material) {
  material.diffuseColor = new BABYLON.Color3(1, 1, 1);
  material.specularColor = new BABYLON.Color3(0, 0, 0);
  material.specularPower = 25.6; // the higher, the smaller the highlights -- I just set it to default from the Blender dungeon scene
  material.emissiveColor = new BABYLON.Color3(0, 0, 0);
  material.ambientColor = new BABYLON.Color3(0.58, 0.58, 0.58);
}

Dungeon.prototype.generateWallsAndFloor = function (scene) {

  try {

    const wallMaterial = new BABYLON.StandardMaterial("wall", scene);
    //    wallMaterial.diffuseTexture = new BABYLON.Texture("assets/3ddesigner/rough-stone-block-wall_base_1k.jpg", scene);
    //    wallMaterial.ambientTexture = new BABYLON.Texture("assets/3ddesigner/rough-stone-block-wall_base_1k.jpg", scene);
    //    wallMaterial.bumpTexture = new BABYLON.Texture("assets/3ddesigner/rough-stone-block-wall_normal_1k.jpg", scene);
    wallMaterial.diffuseTexture = new BABYLON.Texture("assets/wall_DIF.jpg", scene);
    /*    wallMaterial.diffuseTexture.uScale = 1;
        wallMaterial.diffuseTexture.vScale = 1;
        wallMaterial.diffuseTexture.uOffset= 1;
        wallMaterial.diffuseTexture.vOffset = 1; */
    wallMaterial.bumpTexture = new BABYLON.Texture("assets/wall_NRM.jpg", scene);
    wallMaterial.bumpTexture.level = 0.3;
    wallMaterial.freeze();
    this.setDefaultMaterialColors(wallMaterial);

    const floorMaterial = new BABYLON.StandardMaterial("floor", scene);
    floorMaterial.diffuseTexture = new BABYLON.Texture("assets/floor_DIF.jpg", scene);
    floorMaterial.bumpTexture = new BABYLON.Texture("assets/floor_NRM.jpg", scene);
    floorMaterial.bumpTexture.level = 0.3;
    floorMaterial.freeze();
    this.setDefaultMaterialColors(floorMaterial);

    const columnMaterial = new BABYLON.StandardMaterial("column", scene);
    //    wallMaterial.diffuseTexture = new BABYLON.Texture("assets/3ddesigner/rough-stone-block-wall_base_1k.jpg", scene);
    //    wallMaterial.ambientTexture = new BABYLON.Texture("assets/3ddesigner/rough-stone-block-wall_base_1k.jpg", scene);
    //    wallMaterial.bumpTexture = new BABYLON.Texture("assets/3ddesigner/rough-stone-block-wall_normal_1k.jpg", scene);
    columnMaterial.diffuseTexture = new BABYLON.Texture("assets/Column_DIF.jpg", scene);
    columnMaterial.bumpTexture = new BABYLON.Texture("assets/Column_NRM.jpg", scene);
    columnMaterial.bumpTexture.level = 0.3;
    this.setDefaultMaterialColors(columnMaterial);
    //    columnMaterial.diffuseTexture.uOffset= 1;
    columnMaterial.diffuseTexture.vOffset = .22;
    columnMaterial.diffuseTexture.vScale = 1.5;
    columnMaterial.bumpTexture.vOffset = .22;
    columnMaterial.bumpTexture.vScale = 1.5;
    columnMaterial.freeze();


    //	const mat = new BABYLON.StandardMaterial("");
    //	mat.diffuseTexture = new BABYLON.Texture("https://assets.babylonjs.com/environments/tile1.jpg");

    //    const f = new BABYLON.Vector4(0,0, 0.5, 1); // front image = half the whole image along the width 
    //	const b = new BABYLON.Vector4(0.5,0, 1, 1); // back image = second half along the width

    let scaleMultiplier = 7.2;


    const wall = BABYLON.MeshBuilder.CreatePlane("wall", { sideOrientation: BABYLON.Mesh.DOUBLESIDE });
    wall.scaling = new BABYLON.Vector3(1 * scaleMultiplier, 1 * scaleMultiplier, 1 * scaleMultiplier);
    wall.material = wallMaterial;
    wall.isPickable = false;
    //        wall.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY; // supposed to be faster -- for mobile

    const floor = BABYLON.MeshBuilder.CreatePlane("floor", { sideOrientation: BABYLON.Mesh.DOUBLESIDE });
    floor.material = floorMaterial;

    floor.rotation = new BABYLON.Vector3(Math.PI / 2, 0, 0); // Starting all from
    floor.scaling = new BABYLON.Vector3(1 * scaleMultiplier, 1 * scaleMultiplier, 1 * scaleMultiplier);
    floor.position = new BABYLON.Vector3(0, 0, 0); // Starting all from
    floor.isPickable = false;
    floor.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY; // supposed to be faster -- for mobile



    const column = BABYLON.MeshBuilder.CreateCylinder("column", { diameter: 2.5, height: 1 * scaleMultiplier });
    column.material = columnMaterial;
    column.position = new BABYLON.Vector3(12, scaleMultiplier / 2, 24.8);
    column.checkCollisions = true;
    column.isPickable = false;
    column.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY; // supposed to be faster -- for mobile

    /*
            const cube = BABYLON.MeshBuilder.CreateBox("cube", { width: 1 * scaleMultiplier, height: 1 * scaleMultiplier, depth: 1 * scaleMultiplier });
            cube.material = columnMaterial;
            cube.position = new BABYLON.Vector3(8, scaleMultiplier / 2, 4.8);
            cube.checkCollisions = true;
            cube.isPickable = false;
            cube.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY; // supposed to be faster -- for mobile
    
            this.totalAgentsSoFar.push(cube);
    */

    /*
        //Polygon shape in XZ plane
        const pillarShape = [ 
            new BABYLON.Vector3(0, 0, 0), 
            new BABYLON.Vector3(3, 0, 0), 
            new BABYLON.Vector3(5, 0, -2), 
            new BABYLON.Vector3(5, 0, -5), 
            new BABYLON.Vector3(3, 0, -5), 
            new BABYLON.Vector3(4, 0, -15), 
            new BABYLON.Vector3(3, 0, -25), 
            new BABYLON.Vector3(4, 0, -35), 
            new BABYLON.Vector3(5, 0, -38), 
            new BABYLON.Vector3(5, 0, -40), 
            new BABYLON.Vector3(-5, 0, -40), 
            new BABYLON.Vector3(-5, 0, -40), 
            new BABYLON.Vector3(-5, 0, -38), 
            new BABYLON.Vector3(-4, 0, -35),
            new BABYLON.Vector3(-3, 0, -25),
            new BABYLON.Vector3(-4, 0, -15),   
            new BABYLON.Vector3(-3, 0, -5), 
            new BABYLON.Vector3(-5, 0, -5),
            new BABYLON.Vector3(-5, 0, -2),  
            new BABYLON.Vector3(-3, 0, 0), 
        ];
             
        const pillar = BABYLON.MeshBuilder.ExtrudePolygon("polygon", {shape:pillarShape, depth: 5, sideOrientation: BABYLON.Mesh.DOUBLESIDE });
        pillar.rotation = new BABYLON.Vector3(-Math.PI/2,0,0);
        pillar.scaling = new BABYLON.Vector3(.1,.1,.1);
        pillar.position = new BABYLON.Vector3(5,5,0);
        pillar.material = columnMaterial;
        */

    console.log("e");

    let meshArray = [column];

    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        let instancePlane = floor.createInstance("floor_instance" + i + "_" + j);
        instancePlane.position = new BABYLON.Vector3(i * scaleMultiplier, 0.1, j * scaleMultiplier);
        instancePlane.checkCollisions = true;
        instancePlane.freezeWorldMatrix();
        instancePlane.isPickable = false;
        instancePlane.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY; // supposed to be faster -- for mobile
        meshArray.push(instancePlane);
        this.freeFloorTilePositions.push({ x: Math.floor(i * scaleMultiplier), z: Math.floor(j * scaleMultiplier) });
      }
    }
    for (let i = 0; i < 10; i++) {
      let j = -0.5;
      let instanceWall = wall.createInstance("wall_instance" + i + "_" + j);
      instanceWall.position = new BABYLON.Vector3(i * scaleMultiplier, 0.5 * scaleMultiplier, j * scaleMultiplier);
      instanceWall.rotation = new BABYLON.Vector3(0, Math.PI, 0);
      instanceWall.checkCollisions = true;
      instanceWall.freezeWorldMatrix();
      instanceWall.isPickable = false;
      instanceWall.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY; // supposed to be faster -- for mobile

      meshArray.push(instanceWall);

      // ^^ these collisions don't work from the outside of planes (so need double layer of walls if don't want player to walk through from the other side)

      /*        let instancePillar = pillar.createInstance("pillar_instance" + i + "_"+ j);
              instancePillar.position = new BABYLON.Vector3(i,0.5,j); 
              instancePillar.rotation = new BABYLON.Vector3(0,Math.PI,0); 
      */
      instanceWall = wall.createInstance("wall_instance" + j + "_" + i);
      instanceWall.position = new BABYLON.Vector3(j * scaleMultiplier, 0.5 * scaleMultiplier, i * scaleMultiplier);
      instanceWall.rotation = new BABYLON.Vector3(0, -Math.PI / 2, 0);
      instanceWall.checkCollisions = true;
      instanceWall.freezeWorldMatrix();
      instanceWall.isPickable = false;
      instanceWall.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY; // supposed to be faster -- for mobile
      meshArray.push(instanceWall);

      j = 4.5;
      if (i != 5 && i != 6) { // leave a gap in the wall
        instanceWall = wall.createInstance("wall_instance" + i + "_" + j);
        instanceWall.position = new BABYLON.Vector3(i * scaleMultiplier, 0.5 * scaleMultiplier, j * scaleMultiplier);
        instanceWall.checkCollisions = true;
        instanceWall.freezeWorldMatrix();
        instanceWall.isPickable = false;
        instanceWall.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY; // supposed to be faster -- for mobile
        meshArray.push(instanceWall);
      }

      j = 9.5;
      instanceWall = wall.createInstance("wall_instance" + i + "_" + j);
      instanceWall.position = new BABYLON.Vector3(i * scaleMultiplier, 0.5 * scaleMultiplier, j * scaleMultiplier);
      instanceWall.checkCollisions = true;
      instanceWall.freezeWorldMatrix();
      instanceWall.isPickable = false;
      instanceWall.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY; // supposed to be faster -- for mobile
      meshArray.push(instanceWall);

      instanceWall = wall.createInstance("wall_instance" + j + "_" + i);
      instanceWall.position = new BABYLON.Vector3(j * scaleMultiplier, 0.5 * scaleMultiplier, i * scaleMultiplier);
      instanceWall.rotation = new BABYLON.Vector3(0, Math.PI / 2, 0);
      instanceWall.checkCollisions = true;
      instanceWall.freezeWorldMatrix();
      instanceWall.isPickable = false;
      instanceWall.cullingStrategy = BABYLON.AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY; // supposed to be faster -- for mobile
      meshArray.push(instanceWall);

      console.log("f");

    }

    //        console.log(meshArray);
    this.meshesForNavMeshCalc = meshArray; //BABYLON.Mesh.MergeMeshes(meshArray);
    //        console.log(this.meshForNavMeshCalc);

    wall.isVisible = false; // hide original meshes
    floor.isVisible = false;
    //    pillar.isVisible=false;

  } catch (err) {
    console.log(err);
  }

}

Dungeon.prototype.initFpsOverlay = function () {

  // UI
  let advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");
  /*        let UiPanel = new BABYLON.GUI.StackPanel();
          UiPanel.width = "220px";
          UiPanel.fontSize = "14px";
          UiPanel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
          UiPanel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
          advancedTexture.addControl(UiPanel);
  */
  this.fpsText = new BABYLON.GUI.TextBlock();
  this.fpsText.text = "Hello world";
  this.fpsText.color = "white";
  this.fpsText.fontSize = 24;
  this.fpsText.width = "100%";
  this.fpsText.height = "100%";
  this.fpsText.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
  this.fpsText.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
  advancedTexture.addControl(this.fpsText);
  //        UiPanel.addControl(_this.fpsText);
}

Dungeon.prototype.initLoadingScreen = function () {

  if (this._loadingDiv) {
    // Do not add a loading screen if there is already one
    return;
  }
  this._loadingDivBackgroundColor = "#000000";

  this._loadingDiv = document.createElement("div");
  this._loadingDiv.id = "loadingScreen";
  this._loadingDiv.style.opacity = "0";
  this._loadingDiv.style.transition = "opacity 1.5s ease";
  this._loadingDiv.style.pointerEvents = "none";
  // Loading text
  this._loadingTextDiv = document.createElement("div");
  this._loadingTextDiv.style.position = "absolute";
  this._loadingTextDiv.style.left = "0";
  this._loadingTextDiv.style.top = "50%";
  this._loadingTextDiv.style.marginTop = "80px";
  this._loadingTextDiv.style.width = "100%";
  this._loadingTextDiv.style.height = "20px";
  this._loadingTextDiv.style.fontFamily = "Arial";
  this._loadingTextDiv.style.fontSize = "14px";
  this._loadingTextDiv.style.backgroundColor = "#000000";
  this._loadingTextDiv.style.color = "white";
  this._loadingTextDiv.style.textAlign = "center";
  this._loadingTextDiv.innerHTML = "Loading";
  this._loadingDiv.appendChild(this._loadingTextDiv);
  //set the predefined text
  this._loadingTextDiv.innerHTML = "Dungeon Spawning";
  // Generating keyframes
  let style = document.createElement('style');
  style.type = 'text/css';
  let keyFrames = "@-webkit-keyframes spin1 { 0% { -webkit-transform: rotate(0deg);}\n                    100% { -webkit-transform: rotate(360deg);}\n                }                @keyframes spin1 {                    0% { transform: rotate(0deg);}\n                    100% { transform: rotate(360deg);}\n                }";
  style.innerHTML = keyFrames;
  document.getElementsByTagName('head')[0].appendChild(style);
  // Loading img
  let imgBack = new Image();
  imgBack.src = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Swirl.png/480px-Swirl.png";
  imgBack.style.position = "absolute";
  imgBack.style.left = "25%";
  imgBack.style.top = "25%";
  // imgBack.style.marginLeft = "-60px";
  // imgBack.style.marginTop = "-60px";
  imgBack.style.animation = "spin1 2s infinite ease-in-out";
  imgBack.style.webkitAnimation = "spin1 2s infinite ease-in-out";
  imgBack.style.transformOrigin = "50% 50%";
  imgBack.style.webkitTransformOrigin = "50% 50%";
  this._loadingDiv.appendChild(imgBack);
  this._loadingDiv.style.backgroundColor = this._loadingDivBackgroundColor;
  document.body.appendChild(this._loadingDiv);
  this._loadingDiv.style.opacity = "1";

  function customLoadingScreen() {
    console.log("customLoadingScreen creation")
  }
  customLoadingScreen.prototype.displayLoadingUI = function () {
    let loadingScreenDiv = window.document.getElementById("loadingScreen");
    //        console.log("customLoadingScreen loading")
    //        loadingScreenDiv.innerHTML = "loading";
  };
  customLoadingScreen.prototype.hideLoadingUI = function () {
    let loadingScreenDiv = window.document.getElementById("loadingScreen");
    //        console.log("customLoadingScreen loaded")
    loadingScreenDiv.style.display = "none";
  };
  return new customLoadingScreen();

}

Dungeon.prototype.initPlayAreaBounds = function (scene) {
  //    let myGround = BABYLON.MeshBuilder.CreateGround("myGround", {width: 200, height: 200, subdivsions: 4}, scene);
  //    myGround.receiveShadows = true;

  //Bounding box Geometry = prevent player from going outside of ground area

  let border0 = BABYLON.Mesh.CreateBox("border0", 1, scene);
  border0.scaling = new BABYLON.Vector3(1, 100, 200);
  border0.position.x = -100.0;
  border0.checkCollisions = true;
  border0.isVisible = false;

  let border1 = BABYLON.Mesh.CreateBox("border1", 1, scene);
  border1.scaling = new BABYLON.Vector3(1, 100, 200);
  border1.position.x = 100.0;
  border1.checkCollisions = true;
  border1.isVisible = false;

  let border2 = BABYLON.Mesh.CreateBox("border2", 1, scene);
  border2.scaling = new BABYLON.Vector3(200, 100, 1);
  border2.position.z = 100.0;
  border2.checkCollisions = true;
  border2.isVisible = false;

  let border3 = BABYLON.Mesh.CreateBox("border3", 1, scene);
  border3.scaling = new BABYLON.Vector3(200, 100, 1);
  border3.position.z = -100.0;
  border3.checkCollisions = true;
  border3.isVisible = false;
}

Dungeon.prototype.initSkybox = function (scene) {
  // Skybox
  let skybox = BABYLON.Mesh.CreateBox("skyBox", 300.0, scene);
  let skyboxMaterial = new BABYLON.StandardMaterial("skyBox", scene);
  skyboxMaterial.backFaceCulling = false;
  skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture("assets/skybox", scene);
  skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
  skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
  skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
  skybox.material = skyboxMaterial;
}

Dungeon.prototype.initControls = function (scene, camera, canvas) {
  //////////////////////////////////////////////////////////
  // from https://www.babylonjs-playground.com/#PLW9V9#19
  //////////////////////////////////////////////////////////
  //Controls  WASD
  camera.keysUp.push(87);
  camera.keysDown.push(83);
  camera.keysRight.push(68);
  camera.keysLeft.push(65);

  //Jump
  const jump = () => {
    //      console.log(camera.position.y);
    if (camera.position.y > 4.13) { // should be 4, but ends up being 4.12 for some reason, so use 4.13
      return;
    }
    else {
      this.jumping = false; // jump has completed
    }
    if (this.jumping !== true) {
      this.jumping = true;
      camera.cameraDirection.y = 1;//5; // 1 for a more realistic jump
    }

    // got it working by dropping down the gravity to .5 ==> couldn't get above to work consistently, so went with this:
    // https://www.google.com/search?q=babylonjs+jump&oq=babylonjs+jump&aqs=chrome..69i57.2212j0j1&sourceid=chrome&ie=UTF-8
    // https://forum.babylonjs.com/t/how-to-make-first-person-camera-jump/24614/4
    // https://www.babylonjs-playground.com/#3CPL8T#1
    /*        if (this.jumping !== true) {
                this.jumping = true;
                camera.animations = [];
                let a = new BABYLON.Animation("a", "position.y", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
    
                // Animation keys
                let keys = [];
                keys.push({frame: 0, value: camera.position.y});
                keys.push({frame: 20, value: camera.position.y + 60});
                a.setKeys(keys);
    
                let easingFunction = new BABYLON.CircleEase();
                easingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
                a.setEasingFunction(easingFunction);
    
                camera.animations.push(a);
                scene.beginAnimation(camera, 0, 20, false);
            } */
  }

  document.body.onkeyup = function (e) {
    if (e.keyCode == 32) {
      //your code
      console.log("reset jump");
      //            this.jumping=false;
      //            setTimeout(jump(), 10000);

    }
  }
  document.body.onkeydown = function (e) {
    if (e.keyCode == 32) {
      //your code
      console.log("jump");
      jump();
    }

    // hide/show the Inspector
    // Shift+Ctrl+Alt+I
    if (e.shiftKey && e.ctrlKey && e.altKey && e.keyCode === 73) {
      if (scene.debugLayer.isVisible()) {
        scene.debugLayer.hide();
      } else {
        scene.debugLayer.show();
      }
    }

  }


  // only allowed pointer lock if not running in iframe
  if (!utils.isIframe()) {
    // On click event, request pointer lock (that way mouse follows cursor so don't have to hold it down)
    this._onPointerDown = onPointerDown.bind(this)
    this.scene.onPointerDown = this._onPointerDown;

    // Event listener when the pointerlock is updated (or removed by pressing ESC for example).
    this._pointerlockchange = pointerLockChange.bind(this);

    // Attach events to the document
    document.addEventListener("pointerlockchange", this._pointerlockchange, false);
    document.addEventListener("mspointerlockchange", this._pointerlockchange, false);
    document.addEventListener("mozpointerlockchange", this._pointerlockchange, false);
    document.addEventListener("webkitpointerlockchange", this._pointerlockchange, false);
    //////////////////////////////////////////////////////////
    // end from https://www.babylonjs-playground.com/#PLW9V9#19
    //////////////////////////////////////////////////////////
  } else {
    console.log("Couldn't get pointer lock (probably running in a sandboxed iFrame on OpenSea). Player has to click to change the camera rotation.")
  }

}

function pointerLockChange() {
  let controlEnabled = document.mozPointerLockElement || document.webkitPointerLockElement || document.msPointerLockElement || document.pointerLockElement || null;

  // If the user is already locked
  if (!controlEnabled) {
    console.log("detaching")
    this.lastPointerUnlockTS = Date.now();
    //                camera.detachControl(canvas);
    isLocked = false;
  } else {
    console.log("attaching")
    //                camera.attachControl(canvas);
    isLocked = true;
  }
}

function onPointerDown(evt) {
  let canvas = this.engine.getRenderingCanvas();
  console.log("last frame pointerlock ts:" + this.lastPointerUnlockTS);
  //true/false check if we're locked, faster than checking pointerlock on each single click.
  if (!isLocked) {
    console.log("checking");
    canvas.requestPointerLock = canvas.requestPointerLock || canvas.msRequestPointerLock || canvas.mozRequestPointerLock || canvas.webkitRequestPointerLock;
    if (canvas.requestPointerLock) {
      console.log("time since last pointer unlock:" + (Date.now() - this.lastPointerUnlockTS));
      if (Date.now() - this.lastPointerUnlockTS < 1500) {
        console.log("not ready");
        setTimeout(() => {
          console.log("asking for lock");
          canvas.requestPointerLock();
        }, 1500);
      }
      else {
        console.log("asking for lock");
        canvas.requestPointerLock();
      }
    }
  }
  // trigger sword swing
  this.enableswing = true;
  //continue with shooting requests or whatever :P
  console.log(evt);
  //if (evt === 0) {castRay()}; //(left mouse click)
  //evt === 1 (mouse wheel click (not scrolling))
  //evt === 2 (right mouse click)
};

// https://forum.babylonjs.com/t/bring-reticule-crosshair-in-front-of-gui/17565
// https://playground.babylonjs.com/#JU1DZP#4
// another way (not done below): https://playground.babylonjs.com/#JU1DZP
Dungeon.prototype.initCrosshairs = function (camera, scene) {
  this.utilLayer = new BABYLON.UtilityLayerRenderer(scene);

  let w = 128

  let texture = new BABYLON.DynamicTexture('reticule', w, scene, false)
  texture.hasAlpha = true

  let ctx = texture.getContext()
  let reticule

  const createOutline = () => {
    let c = 2

    ctx.moveTo(c, w * 0.25)
    ctx.lineTo(c, c)
    ctx.lineTo(w * 0.25, c)

    ctx.moveTo(w * 0.75, c)
    ctx.lineTo(w - c, c)
    ctx.lineTo(w - c, w * 0.25)

    ctx.moveTo(w - c, w * 0.75)
    ctx.lineTo(w - c, w - c)
    ctx.lineTo(w * 0.75, w - c)

    ctx.moveTo(w * 0.25, w - c)
    ctx.lineTo(c, w - c)
    ctx.lineTo(c, w * 0.75)

    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(128, 228, 128, 1)'
    ctx.stroke()
  }

  const createNavigate = () => {
    ctx.fillStyle = 'transparent'
    ctx.clearRect(0, 0, w, w)
    createOutline()

    ctx.strokeStyle = 'rgba(48, 228, 48, 0.9)'
    ctx.lineWidth = 3.5
    ctx.moveTo(w * 0.5, w * 0.25)
    ctx.lineTo(w * 0.5, w * 0.75)

    ctx.moveTo(w * 0.25, w * 0.5)
    ctx.lineTo(w * 0.75, w * 0.5)
    ctx.stroke()
    ctx.beginPath()

    texture.update()
  }

  createNavigate()

  let material = new BABYLON.StandardMaterial('reticule', scene)
  material.diffuseTexture = texture
  material.opacityTexture = texture
  material.emissiveColor.set(1, 1, 1)
  material.disableLighting = true

  let plane = BABYLON.MeshBuilder.CreatePlane('reticule', { size: 0.04 }, this.utilLayer.utilityLayerScene)
  plane.material = material
  plane.position.set(0, 0, 1.1)
  plane.isPickable = false
  plane.rotation.z = Math.PI / 4

  /* for adding sword and shield
      let plane2 = BABYLON.MeshBuilder.CreatePlane('reticule', { size: 0.04 }, utilLayer.utilityLayerScene)
      plane2.material = material
      plane2.position.set(.2, 0, 1.1)
      plane2.isPickable = false
      plane2.rotation.z = Math.PI / 4
      plane2.parent = camera;
  */
  reticule = plane
  reticule.parent = camera
  return reticule
}

Dungeon.prototype.initLights = function () {

  this.scene.lights.forEach(function (l) {
    l.dispose(); // get rid of existing lights
  });

  let randomNumber = function (min, max) {
    if (min === max) {
      return (min);
    }
    let random = Math.random();
    return ((random * (max - min)) + min);
  };

  this.scene.ambientColor = new BABYLON.Color3(1, 1, 1); // set ambient light color/brightness

  // Hemispheric light to light the scene
  let h = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), this.scene);
  h.intensity = 0.2;
  //    h.specular = new BABYLON.Color3.Black() // tried this from https://forum.babylonjs.com/t/how-to-make-a-not-glossy-material/19286
  /*
      let torch1 = this.scene.getMeshByName("torch");
      let torch2 = this.scene.getMeshByName("torch01");
  
      let pl1 = new BABYLON.PointLight("pl1", torch1.position, this.scene);
      let pl2 = new BABYLON.PointLight("pl2", torch2.position, this.scene);
      pl1.intensity = pl2.intensity = 0.5;
      pl1.diffuse = pl2.diffuse = BABYLON.Color3.FromInts(255, 123, 63);
      pl1.range = pl2.range = 30;
  
      //    pl1.specular = new BABYLON.Color3.Black()
      //    pl2.specular = new BABYLON.Color3.Black()
  
      let positive = true;
      let di = randomNumber(0, 0.05);
      setInterval(function () {
          if (positive) {
              di *= -1;
          } else {
              di = randomNumber(0, 0.05);
          }
          positive = !positive;
          pl1.intensity += di;
          pl2.intensity += di;
  
      }, 50); */
};

/*
Dungeon.prototype.initTorches = function () {
    let particleSystem = new BABYLON.ParticleSystem("particles", 2000, this.scene);

    //Texture of each particle
    particleSystem.particleTexture = new BABYLON.Texture("particles/flame.png", this.scene);

    let torch1 = this.scene.getMeshByName("torch");
    let torch2 = this.scene.getMeshByName("torch01");

    particleSystem.emitter = torch1;
    particleSystem.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    particleSystem.minSize = 0.8;
    particleSystem.maxSize = 1.2;
    particleSystem.minLifeTime = 0.3;
    particleSystem.maxLifeTime = 1.5;
    particleSystem.minEmitBox = new BABYLON.Vector3(-0.1, 0, -0.1); // Starting all from
    particleSystem.maxEmitBox = new BABYLON.Vector3(0.1, 0.1, 0.1); // To...
    particleSystem.emitRate = 75;
    particleSystem.start();

    let ps2 = particleSystem.clone();
    ps2.emitter = torch2;
    ps2.start();
};
*/

Dungeon.prototype.initShadows = function () {

  this.scene.meshes.forEach(function (mesh) {
    mesh.checkCollisions = true;
    if (mesh.name.indexOf("floor") != -1) {
      mesh.receiveShadows = true;
    }
  });

  let dl = new BABYLON.DirectionalLight("light", new BABYLON.Vector3(0, -0.5, -0.3), this.scene);
  dl.intensity = 0.5;
  let generator = new BABYLON.ShadowGenerator(512, dl);

  this.scene.meshes.forEach(function (mesh) {
    if (mesh.name.indexOf("shadow") != -1) {
      generator.getShadowMap().renderList.push(mesh);
    }
  });
  generator.useBlurVarianceShadowMap = true;
  //generator.blurBoxOffset = 0.5;

};

Dungeon.prototype.initCollisions = function () {
  this.scene.gravity = new BABYLON.Vector3(0, -.5, 0); //-9.81, 0);
  this.scene.collisionsEnabled = true;

  let cam = this.scene.activeCamera;
  cam.applyGravity = true;
  cam.ellipsoid = new BABYLON.Vector3(2.55, 2, 2.55); // the player size -- https://doc.babylonjs.com/divingDeeper/cameras/camera_collisions
  cam.checkCollisions = true;
  cam.position = new BABYLON.Vector3(0, 4, 0);
  cam.rotation = new BABYLON.Vector3(0, 0, 0);

  this.scene.meshes.forEach(function (mesh) {
    if (mesh.name.indexOf("collider") != -1) {
      mesh.isVisible = false;
    }
  });
};

Dungeon.prototype.initFx = function (camera) {

  // STEPS
  let step1 = new BABYLON.Sound("step1", "assets/sounds/step1.wav", this.scene);
  let step2 = new BABYLON.Sound("step2", "assets/sounds/step2.wav", this.scene);
  let step3 = new BABYLON.Sound("step3", "assets/sounds/step3.wav", this.scene);

  let goToStep2 = false;
  let walking = false;

  step1.onended = function () {
    goToStep2 = true;
  };
  step2.onended = function () {
    goToStep2 = false;
  };
  step3.onended = function () {
    goToStep2 = false;
  };

  let rattling = 0;
  let RATL = 777;
  let CAMERAFOV = camera.fov;
  let tookHit = false;

  const resetPositionProgress = (mesh, startX, startY, changeAmt) => {
    if (mesh.position.x > startX) {
      mesh.position.x -= changeAmt;
      if (mesh.position.x < startX) {
        mesh.position.x = startX;
      }
    }
    if (mesh.position.x < startX) {
      mesh.position.x += changeAmt;
      if (mesh.position.x > startX) {
        mesh.position.x = startX;
      }
    }
    if (mesh.position.y > startY) {
      mesh.position.y -= changeAmt;
      if (mesh.position.y < startY) {
        mesh.position.y = startY;
      }
    }
    if (mesh.position.y < startY) {
      mesh.position.y += changeAmt;
      if (mesh.position.y > startY) {
        mesh.position.y = startY;
      }
    }
    if (mesh.position.x == startX && mesh.position.y == startY) {
      /*                        console.log("after:" + mesh.position.x +"," + mesh.position.y + "," 
                  + startX +"," + startY)
                  console.log("reseting position"); */
      return false;
    }
    return true;
  }

  const updateHit = () => {
    if (tookHit) {
      rattling = Math.min(Math.max(parseInt(40 - dist), 5), 20);
    }
  }

  const camShake = () => {
    if (rattling > 0) {
      rattling--;
      if (rattling % 6 == 0) {
        camera.fov = CAMERAFOV + rattling / RATL;
        camera.rotation.z = rattling / RATL;
      } else if (rattling % 6 == 3) {
        camera.fov = CAMERAFOV - rattling / RATL;
        camera.rotation.z = -rattling / RATL;
      }
    } else {
      camera.fov = CAMERAFOV;
      camera.rotation.z = 0;
    }
  }

  let lastUpdate = Date.now();
  let _sword;
  let _scene = this.scene;
  let resetSwordPosition = false;
  let swordBobInProgress = false;
  let swordStartX;
  let swordStartY;
  let swordSwingInProgress = true;
  let swordStartRot;
  let swordSwingUp = false;
  let swordSwingDown = false;
  let swordSwingReturnToStartPosition = false;

  this.scene.registerBeforeRender(function () {
    updateHit();
    camShake();
    if (this.sword) {
      if (this.sword.intersectsMesh(this.enemyAgents[0].mesh, false) || this.sword.intersectsMesh(this.enemyAgents[1].mesh, false) || this.sword.intersectsMesh(this.enemyAgents[2].mesh, false)) {
        console.log('Collision-----------')
      } else {
        console.log('No Collision.....')
      }
    }

    let delta = Date.now() - lastUpdate;
    lastUpdate = Date.now();

    // have to move this elsewhere since activates only when click (hopefully can have two
    // registerBeforeRender methods)
    /*        if (_sword && swordSwingInProgress) {
                console.log("here");
                if (!swordSwingUp && !swordSwingDown && !swordSwingReturnToStartPosition) {
                    swordStartRot = _sword.rotation;
                    swordSwingUp = true;
                }
                if (swordSwingUp) {
                    _sword.rotation.x+=Math.PI*delta/1000;
                    _sword.rotation.y+=Math.PI*delta/500;
                }
            }
    */
    // console.log('walking:',walking)
    if (walking) {
      // If no sound is playing
      if (!step1.isPlaying && !step2.isPlaying && !step3.isPlaying) {
        if (Math.random() < 0.2) {
          step3.play();
        } else if (!goToStep2) {
          step1.play();
        } else {
          step2.play();
        }
      }

      const motion = Math.sin(delta);

      if (!_sword) {
        _sword = _scene.getMeshByName("__sword__");
      }
      if (_sword) { // if sword hasn't been loaded yet, skip next

        if (!swordBobInProgress && !resetSwordPosition) {
          //                  console.log("reseting sword start x/y");
          swordStartX = _sword.position.x;
          swordStartY = _sword.position.y;
          swordBobInProgress = true;
        }
        else if (resetSwordPosition) {
          //                    console.log("resetSwordPosition: " + resetSwordPosition);
          //                    console.log("going back to start x/y: " + _sword.position.x +"," + _sword.position.y + "," 
          //                    + swordStartX +"," + swordStartY)
          let changeAmt = delta * 0.0001;
          //                    console.log(delta+","+changeAmt);
          resetSwordPosition = resetPositionProgress(_sword, swordStartX, swordStartY, changeAmt);
        }
        else {
          _sword.position.x += motion * 0.005
          _sword.position.y += Math.abs(motion) * 0.005

          // head position
          //                    camera.position.x = motion * 0.014
          //                    camera.position.y = Math.abs(motion) * 0.012
          //                    console.log("updating sword position " + _sword.position.x +"," + _sword.position.y)

          if (Math.abs(swordStartX - _sword.position.x) > .05) {
            //                        console.log("resetting position");
            resetSwordPosition = true;
            swordBobInProgress = false;
          }
        }
      }

    }
  });


  let keysDown = [];
  window.addEventListener("keydown", function (evt) {
    //        console.log(evt.keyCode);
    if ((evt.keyCode >= 37 && evt.keyCode <= 40) || evt.keyCode == 87 || evt.keyCode == 65 || evt.keyCode == 68 || evt.keyCode == 83) {
      walking = true;
      if (!keysDown.includes(evt.keyCode)) {
        keysDown.push(evt.keyCode);
      }
    }
  });
  // bug where lift key stops playing walking sound if still holding another key
  window.addEventListener("keyup", function (evt) {
    if ((evt.keyCode >= 37 && evt.keyCode <= 40) || evt.keyCode == 87 || evt.keyCode == 65 || evt.keyCode == 68 || evt.keyCode == 83) {
      deleteFromArray(keysDown, evt.keyCode);
      if (keysDown.length == 0) {
        walking = false; // no more walking keys held down, stop playing the sound
      }
    }
  });
  /*
      // FIRE sound, centered around the two torches
      let fire = new BABYLON.Sound("fire", "assets/sounds/fire1.wav", this.scene,
          null, { loop: true, autoplay: true, spatialSound: true, maxDistance: 20, volume: 0.2 });
      let fire2 = new BABYLON.Sound("fire2", "assets/sounds/fire2.wav", this.scene,
          null, { loop: true, autoplay: true, spatialSound: true, maxDistance: 20, volume: 0.2 });
  
      let torch1 = this.scene.getMeshByName("torch");
      let torch2 = this.scene.getMeshByName("torch01");
      fire.setPosition(torch1.position);
      fire2.setPosition(torch2.position);
      */
};

const deleteFromArray = (array, val) => {
  const index = array.indexOf(val);
  if (index > -1) { // only splice array when item is found
    array.splice(index, 1); // 2nd parameter means remove one item only
  }
}


export { Dungeon }
