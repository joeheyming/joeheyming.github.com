#include "Environment.h"

Environment::Environment(int * _gameStatus, string _startLevel){

	gameStatus = _gameStatus;
	startLevel = _startLevel;

	ghostHome = new vector<Vector>;
	powerPills = new vector<Vector>;
	teleports = new vector<Vector>;

	cout << startLevel << endl;
	fileReader(startLevel);

	ghosts = new GhostP[numGhosts];

	player = new Pacman((double)pacmanX, (double)pacmanY,
			  (*levels)[pacmanLevel].getTerrains()[pacmanY][pacmanX]->getHeight(),
			  scale,
			  (*levels)[pacmanLevel].getTerrains()[pacmanY][pacmanX],
			  gameStatus, teleports);

	cam = new Camera(25, 250.0, this);

	srand( time( NULL ) );	

	for(int i = 0; i < numGhosts; i++){
		enemy = new Ghost(ghost.x, ghost.y,
			  (*levels)[(int)ghost.z].getTerrains()[(int)ghost.y][(int)ghost.x]->getHeight(),
			  scale,
			  (*levels)[(int)ghost.z].getTerrains()[(int)ghost.y][(int)ghost.x],
			  player->getRadius(), gameStatus);//, teleports);
		ghosts[i] = enemy;
	}



	cout << "Environment Constructed!!!" << endl;
}

void Environment::draw(){
  
  glPushMatrix();
  
	glEnable(GL_LIGHT0);
  
	//draw levels
	for(int i = 0; i < numLevels; i++)
	levels[i]->draw();
      
	//draw objects
      
	//draw pacman
	if(cameraMode != FPPOV)
		player->draw();

	//draw ghosts
	for(int j = 0; j < numGhosts; j++)
		ghosts[j]->draw();
  
  glPopMatrix();
}

void Environment::update(){
	for(int i = 0; i < numGhosts; i++)
		ghosts[i]->update(player->getCoords(), player->getStatus());
	player->update();
}

void Environment::fileReader(string filename){
  
	char params[5];

	ifstream file (filename.c_str());

	file >> params;
	width = (double)atoi(params);

	file >> params;
	length = (double)atoi(params);

	file >> params;
	numLevels = (double)atoi(params);

	file >> params;
	scale = (double)atoi(params);

	file >> params;
	numPacmen = atoi(params);

	file >> params;
	numGhosts = atoi(params);
	cout << "Ghosts" << numGhosts << endl;

	file >> params;
	pacmanX = atoi(params);

	file >> params;
	pacmanY = atoi(params);

	file >> params;
	pacmanLevel = atoi(params);

	file >> params;
	ghostHomeSize = atoi(params);

	file >> params;
	ghost.x = (double)atoi(params);

	file >> params;
	ghost.y = (double)atoi(params);

	file >> params;
	ghost.z = (double)atoi(params);

	ghostHome->push_back(ghost);

	//get coordinates of ghost home
	for(int i = 1; i < ghostHomeSize; i++){
		Vector temp;

		file >> params;
		temp.x = (double)atoi(params);

		file >> params;
		temp.y = (double)atoi(params);

		file >> params;
		temp.z = (double)atoi(params);

		ghostHome->push_back(temp);
	}

	file >> params;
	numPowerPills = atoi(params);

	//get coordinates of power pills
	for(int j = 0; j < numPowerPills; j++){
		Vector temp;

		file >> params;
		temp.x = (double)atoi(params);

		file >> params;
		temp.y = (double)atoi(params);

		file >> params;
		temp.z = (double)atoi(params);

		powerPills->push_back(temp);
	}

	// get teleports
	for(int k = 0; k < 2; k++){
		Vector temp;

		file >> params;
		temp.y = (double)atoi(params);

		file >> params;
		temp.x = (double)atoi(params);

		file >> params;
		temp.z = (double)atoi(params);

		teleports->push_back(temp);
	}

	numCharacters = numPacmen + numGhosts;

	levels = new LevelP[(int)numLevels];

	map = new intPP[(int)numLevels];

	double base = 0, maxHeight = 0;

	for(int lev = 0; lev < numLevels; lev++){
		levels[lev] = new Level;
		map[lev] = new intP[(int)length];
		for(int len = (int)length-1; len >= 0; len--){
			map[lev][len] = new int[(int)width];
			for(int wid = (int)width-1; wid >= 0; wid--){
				file >> params;
				map[lev][len][wid] = atoi(params);
				if(map[lev][len][wid] > maxHeight)
					maxHeight = map[lev][len][wid];
			}
		}
		levels[lev]->setLevel(map[lev], width, length,
				base, scale, ghostHome, powerPills, teleports);
		base += maxHeight;
		maxHeight = 0;
	}
}
