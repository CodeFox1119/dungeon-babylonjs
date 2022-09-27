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
    console.log("mshfilename mesh cache:",this.meshCache[meshFilename]);
//    var newClone = this.meshCache[meshFilename].clone(meshFilename + this.actorsAvailableOnLevel);
    let newClone = this.meshCache[meshFilename].instantiateModelsToScene(undefined, false, { doNotInstantiate: true });

    newClone.rootNodes[0].position = new BABYLON.Vector3(actorPosition.x, 9.1, actorPosition.z);
    newClone.rootNodes[0].ellipsoid = new BABYLON.Vector3(2, 1, 2); // the character size for collisions -- https://doc.babylonjs.com/divingDeeper/cameras/camera_collisions
    newClone.rootNodes[0].checkCollisions = true; 

    console.log(newClone.animationGroups);

    this.actorsAvailableOnLevel++;

//    newClone.animationGroups[0].start();
//    newClone.animationGroups[0].loopAnimation = true;
    

    // https://playground.babylonjs.com/#AJA5J6#146    
    // to change material - for bosses, etc
/*    const newMat = new BABYLON.PBRMaterial("pbr", scene)
    newMat.albedoColor = BABYLON.Color3.Teal()
    newClone.rootNodes[0].material=newMat;   
*/   
    this.totalAgentsSoFar.push(newClone);
}

MeshAndActorManager.prototype.addActor = async function (actorPosition, meshFilename, scene, dungeon) {
//    console.log("mesh cache " + meshFilename);
//    console.log(this.meshCache[meshFilename]);
    if (this.meshCache[meshFilename]) {
        console.log("calling createnwinstance");
        console.log("actorPosition:",actorPosition)
        this.createNewClone(actorPosition, meshFilename, scene);
        console.log("done calling createnwinstance");
        return;
//        return this.meshCache[meshFilename]; // return our cached mesh
    }
    // otherwise import the mesh

    //const sleep = ms => new Promise(r => setTimeout(r, ms));

    let _this = this;

    // Clone an asset via instantiateModelsToScene so can have different animations and materials on them
    // https://playground.babylonjs.com/#AJA5J6#146    
    let container = await BABYLON.SceneLoader.LoadAssetContainerAsync("assets/meshes/", meshFilename + ".glb", 
                                            scene);
/*
        let skeleton = container.skeletons[0];
        console.log("skeleton");
        console.log(skeleton);
        skeleton.animationPropertiesOverride = new BABYLON.AnimationPropertiesOverride() 
        skeleton.animationPropertiesOverride.enableBlending = true;
        skeleton.animationPropertiesOverride.blendingSpeed = 0.05;
        skeleton.animationPropertiesOverride.loopMode = 1;
*/

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


/*        // add debug cube for collision testing
        var agentCube = BABYLON.MeshBuilder.CreateBox("cube", { size: 14.2, height: 28.2 }, scene);
        var matAgent = new BABYLON.StandardMaterial('mat2', scene);
        var variation = Math.random();
        matAgent.diffuseColor = new BABYLON.Color3(0.4 + variation * 0.6, 0.3, 1.0 - variation * 0.3);
        agentCube.material = matAgent;
        agentCube.parent = root;
*/

        for (let i = 0; i < container.meshes.length; i++) {
            if (i==0) {
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
                container.meshes[i].ellipsoid = new BABYLON.Vector3(2, 1, 2); // the character size for collisions -- https://doc.babylonjs.com/divingDeeper/cameras/camera_collisions
                container.meshes[i].checkCollisions = true;
            }  

//            container.meshes[i].isVisible=false; // don't display original meshes (only display instantiated clones)
        }

        
/* // don't add to scene--only want the clones added        
        container.addAllToScene();

        container.animationGroups[1].start();
        container.animationGroups[1].loopAnimation = true;
*/
        _this.meshCache[meshFilename] = container;
        _this.createNewClone(actorPosition, meshFilename, scene);        
//        _this.actorsAvailableOnLevel++;
//        _this.totalAgentsSoFar.push(root);

        console.log("setting mesh cache " + meshFilename);
        console.log(_this.meshCache[meshFilename]);

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

    if (!this.agentsReadyToInitialize && this.getActorsAvailableOnLevel()==dungeon.actorsOnCurrentLevel.length) {
        this.canInitAgents();
    }

    if (!this.agentsInitialized && this.agentsReadyToInitialize) {
        for (let i =0; i< this.totalAgentsSoFar.length; i++) {
            dungeon.addToCrowdAI(this.totalAgentsSoFar[i]);
        }
        this.agentsInitialized=true;
    }

}

export { MeshAndActorManager }