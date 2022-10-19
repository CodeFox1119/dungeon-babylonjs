var MeshAndActorManager = function () {
    this.meshCache = [];
}

MeshAndActorManager.prototype.initNewLevel = function () {
    this.agentsReadyToInitialize = false;
    this.agentsInitialized = false;
    this.totalAgentsSoFar = []; // list of total agents so they can be added via addToCrowdAI after the agents are loaded and ready to initialize 
    this.enemyAgents = []; // current active enemy agents
    this.actorsAvailableOnLevel = 0;
}

MeshAndActorManager.prototype.createNewClone = function (actorPosition, meshFilename, scene) {
    console.log('CreateNewClone...')
    let newClone = this.meshCache[meshFilename].instantiateModelsToScene(undefined, false, { doNotInstantiate: true });
    newClone.rootNodes[0].position = new BABYLON.Vector3(actorPosition.x, 9.1, actorPosition.z);
    newClone.rootNodes[0].ellipsoid = new BABYLON.Vector3(2, 1, 2); // the character size for collisions -- https://doc.babylonjs.com/divingDeeper/cameras/camera_collisions
    newClone.rootNodes[0].checkCollisions = true;
    this.actorsAvailableOnLevel++;
    this.totalAgentsSoFar.push(newClone);
}

MeshAndActorManager.prototype.addActor = async function (actorPosition, meshFilename, scene, dungeon) {
    if (this.meshCache[meshFilename]) {
        this.createNewClone(actorPosition, meshFilename, scene);
        return;
    }
    let _this = this;

    // Clone an asset via instantiateModelsToScene so can have different animations and materials on them
    // https://playground.babylonjs.com/#AJA5J6#146    
    let container = await BABYLON.SceneLoader.LoadAssetContainerAsync("assets/meshes/", meshFilename + ".glb",
        scene);

    // enable animation blending
    // https://forum.babylonjs.com/t/animationgroups-blending-only-for-imported-gltf/5029/3
    for (let i = 0; i < container.animationGroups.length; i++) {
        for (var index = 0; index < container.animationGroups[i].targetedAnimations.length; index++) {
            var animation = container.animationGroups[i].targetedAnimations[index].animation;
            animation.enableBlending = true;
            animation.blendingSpeed = 0.1;
        }
    }

    var root = container.meshes[0];
    root.name = '__' + meshFilename + '__';
    root.id = '__' + meshFilename + '__';
    root.checkCollisions = true;
    for (let i = 0; i < container.meshes.length; i++) {
        if (i == 0) {
            container.meshes[i].position = new BABYLON.Vector3(actorPosition.x, 1.1, actorPosition.z);
            container.meshes[i].rotation = new BABYLON.Vector3(Math.PI / 4, 0, 0); //BABYLON.Tools.ToRadians(-90), 0, 0);
            container.meshes[i].scaling = new BABYLON.Vector3(.17, .17, .17);

        }
        else {
            // don't set position of nodes below root node, as messes up the nav mesh positioning
            container.meshes[i].rotation = new BABYLON.Vector3(Math.PI / 4, 0, 0); //BABYLON.Tools.ToRadians(-90), 0, 0);
            //                newMeshes[i].scaling.scaleInPlace(0.3);
            container.meshes[i].scaling = new BABYLON.Vector3(.17, .17, .17);
        }
        // need to set, so player can't collide with clones
        if (i != 0) { // don't need collisions on root.. ideally want to place on the biggest mesh
            // container.meshes[i].ellipsoid = new BABYLON.Vector3(2, 1, 2); // the character size for collisions -- https://doc.babylonjs.com/divingDeeper/cameras/camera_collisions
            container.meshes[i].checkCollisions = true;
            // container.meshes[i].showBoundingBox = true;
        }
    }

    _this.meshCache[meshFilename] = container;
    _this.createNewClone(actorPosition, meshFilename, scene);
}

MeshAndActorManager.prototype.getActorsAvailableOnLevel = function () {
    return this.actorsAvailableOnLevel;
}

MeshAndActorManager.prototype.canInitAgents = function () {
    // last mesh? then set the below to true
    this.agentsReadyToInitialize = true;
}

// check if we can init the crowd AI agents
MeshAndActorManager.prototype.checkInitCrowd = function (dungeon) {
    if (!this.agentsReadyToInitialize && this.getActorsAvailableOnLevel() == dungeon.actorsOnCurrentLevel.length) {
        this.canInitAgents();
    }
    if (!this.agentsInitialized && this.agentsReadyToInitialize) {
        for (let i = 0; i < this.totalAgentsSoFar.length; i++) {
            dungeon.addToCrowdAI(this.totalAgentsSoFar[i]);
        }
        this.agentsInitialized = true;
    }
}

export { MeshAndActorManager }