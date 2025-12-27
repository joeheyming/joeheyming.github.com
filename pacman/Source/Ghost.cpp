#include "Ghost.h"


Ghost::Ghost(double startx, double starty, double startz, double _scale,
	       Terrain * p, double _pacRad, int * _gameStatus){
  
	location = p;
	lastLoc = NULL;

	home = location;

	scale = _scale;

	radius = scale/2.5;
	pacRad = _pacRad;

	gameStatus =  _gameStatus;

	alpha = 1;

	//position is center of ghost
	double pos[3] = {startx*scale+scale/2, 
		starty*scale+scale/2, 
	(location->getHeight())*scale+scale/2};
	position = pos;

	double a[3] = {0,1,0};
	double b[3] = {0,-1,0};
	double c[3] = {-1,0,0};
	double d[3] = {1,0,0};

	up = a;
	down = b;
	left = c;
	right = d;

	facing = up;

	moveSpeed = 2;//must be evenly divisible by scale
	homeSpeed = 5;//must be evenly divisible by scale

	roll = pitch = yaw = 0.0;

	dead = false;
	moving = false;

	double random = (double)rand() / (RAND_MAX + 1.0);
	red = random;

	random = (double)rand() / (RAND_MAX + 1.0);
	green = random;

	random = (double)rand() / (RAND_MAX + 1.0);
	blue = random;
}

void Ghost::draw(){
  glPushMatrix();
      qd = gluNewQuadric();

      // bring the model to the coordinates
      glTranslatef(position.x,
		   position.y,
		   position.z);
      // rotate the model to face the correct direction
      glRotatef(yaw, 0.0, 0.0, 1.0);
      
      // draw the eyes
      drawEyes();

	  if(!dead){
	      drawMouth();
		  if(pacStatus == CHASE)
			  glColor4f(0.0, 0.0, 1.0, alpha);
		  else
			  glColor4f(red, green, blue, alpha);
		  drawHead();
		  drawBody();
	  }

      gluDeleteQuadric(qd);
  
  glPopMatrix();
}

void Ghost::drawEyes(){
	if(!dead)
		// make them invisible
		glColor4f(0.0, 0.0, 0.0, 0.0);
	else
		//draw eyes white
		glColor4f(1.0, 1.0, 1.0, 1.0);
	glPushMatrix();
	  glTranslatef(0,0,radius);
	  glPushMatrix();
		  // translate the eye to the radius of the body
		  // rotate the eye up above the max mouth angle
		  // rotate each eye by a symetrical amount
		  glRotatef(30, 0.0, 0.0, 1.0);
	  glRotatef(50, 1.0, 0.0, 0.0);
	  glTranslatef(0,radius,0);
	  glutSolidSphere(1, 6, 6); 
	  glPopMatrix();
	  glPushMatrix();
		  glRotatef(-30, 0.0, 0.0, 1.0);
	  glRotatef(50, 1.0, 0.0, 0.0);
	  glTranslatef(0,radius,0);
	  glutSolidSphere(1, 6, 6);
	  glPopMatrix();
	glPopMatrix();
}

void Ghost::drawMouth(){
	// make mouth invisible
	glColor4f(0.0, 0.0, 0.0, 0.0);

	glPushMatrix();
	  glTranslatef(0,0,radius);
	  glPushMatrix();
		  // translate the mouth to the radius of the body
		  // rotate the mouth up above the max mouth angle
		  //glRotatef(50, 1.0, 0.0, 0.0);
		  glTranslatef(0,radius,0);
		  glutSolidSphere(.75, 6, 6); 
	  glPopMatrix();
	glPopMatrix();
}

void Ghost::drawHead(){
  glPushMatrix();
      glTranslatef(0,0,radius);
      // draw a half sphere
      gluSphere(qd,radius,30,30);
  glPopMatrix();
}

void Ghost::drawBody(){
  glPushMatrix();
      
  GLUquadricObj *q;

	glTranslatef(0,0,-radius/3);

	q = gluNewQuadric();
	gluQuadricDrawStyle(q,GLU_FILL);
	gluQuadricNormals(q,GLU_SMOOTH);
	gluCylinder(q,radius,radius,radius*3/2,20,20);

  glPopMatrix();
}

void Ghost::update(Vector _pacLoc, int _pacStatus){
	if(*gameStatus == DEATH)
		return;
	
	pacLoc = _pacLoc;
	pacStatus = _pacStatus;

	//ghost died!
	if(!dead && pacmanTest(location) && pacStatus == CHASE){
		dead = true;
		moving = false;
		PlaySound("GHOSTEATEN.WAV",NULL,SND_FILENAME|SND_ASYNC);
		Sleep(1000);
	}
	//pacman died!
	if(!dead && pacmanTest(location) && pacStatus == FLEE){
		PlaySound("killed.wav",NULL,SND_FILENAME|SND_ASYNC);
		*gameStatus = DEATH;
	}

	if(dead && !moving){
		//initialize starting node
		SearchNode * startNode = new SearchNode();
		startNode->terrain = location;
		startNode->parent = NULL;
		startNode->cost = 0;
		startNode->heuristicValue = heuristic(location);
		startNode->total = startNode->heuristicValue;

		//start the A* search, which will 
		//result in a full path home
		goHome(startNode);

		//start ghost moving along path
		moving = true;

		//start ghost in center of terrain
		position.x = location->getCoords().x+scale/2;
		position.y = location->getCoords().y+scale/2;
	}

	if(!moving){
		if(!dead){
			//randomly choose paths
			generatePath();
			moving = true;
		}
	}

	// simply move along the chosen path
	move();
}

void Ghost::generateGreedyPath(){

	vector <Terrain*> choices = getSurrounding(location, lastLoc);

	// loop through and sort nodes
	for(int j = 0; j < choices.size(); j++){
		SearchNode* newNode = new SearchNode();
		newNode->terrain = choices[j];
			
		newNode->cost = 0;
		newNode->heuristicValue = heuristic(newNode->terrain);
		newNode->total = newNode->cost + newNode->heuristicValue;

		if(pacmanTest(newNode->terrain)){
			path.push_back(newNode->terrain);
			return;
		}

		movesHome.push(newNode);
	}
	path.push_back(movesHome.pop()->terrain);
}

//ghost makes random choices
void Ghost::generatePath(){

	// get surrounding nodes to choose from
	vector <Terrain*> choices = getSurrounding();

	// make random number
	int random = 100 * rand() / (RAND_MAX + 1.0);

	// randomly pick move to make
	for(int i = 0; i < choices.size(); i++){
		if(random < (100 / choices.size()) * (i + 1)){
			//pick this move
			nextLoc = choices[i];
			return;
		}
	}
}

//use A* algorithm to go home (used when ghost dies)
void Ghost::goHome(SearchNode* bestNode){	

	// if path to home is found calculate path and return
	if(homeTest(bestNode->terrain)){
		// generate path that was found
		path.clear();
		calculatePath(bestNode);
		movesHome.clear();
		return;
	}

	// get surrounding nodes to add to queue
	vector <Terrain*> choices;
	if(bestNode->parent == NULL)
		choices = getSurrounding(bestNode->terrain, NULL);
	else
		choices = getSurrounding(bestNode->terrain, 
			bestNode->parent->terrain);

	// loop through and add nodes to priority queue
	for(int i = 0; i < choices.size(); i++){
		SearchNode* newNode = new SearchNode();

		newNode->terrain = choices[i];
		newNode->parent = bestNode;			
		newNode->cost = bestNode->cost + 1;
		newNode->heuristicValue = heuristic(newNode->terrain);
		newNode->total = newNode->cost + newNode->heuristicValue;

		movesHome.push(newNode);
	}

	//home was not found!
	if(movesHome.empty()){	
		return;
	}

	//recursively continue A* search
	goHome(movesHome.pop());
}

// add new choices to the priority queue of moves
void Ghost::calculatePath(SearchNode* node){
	if(node->parent == NULL){
		return;
	}
	path.push_back(node->terrain);
	calculatePath(node->parent);
}

// physically move along predefined path
void Ghost::move(){
	// if no more moves to make, start a new search
	if(path.empty() && nextLoc == NULL){
		moving = false;
		return;
	}

	// if no path exists, just use nextLoc
	if(path.empty()){
		path.push_back(nextLoc);
	}

	Vector oldPos = position;

	double speed = 2;
	if(!dead)
		speed = moveSpeed;
	else
		speed = homeSpeed;

	// move in direction of next floor tile in path
	position.x = position.x + 
		((path.back()->getCoords().x - location->getCoords().x)/(scale / speed));
	position.y = position.y + 
		((path.back()->getCoords().y - location->getCoords().y)/(scale / speed));
	
	if(position.x > oldPos.x){
		facing = right;
		yaw = 270;
	}
	else if(position.y > oldPos.y){
		facing = up;
		yaw = 0;
	}
	else if(position.x < oldPos.x){
		facing = left;
		yaw = 90;
	}
	else if(position.y < oldPos.y){
		facing = down;
		yaw = 180;
	}

	//ghost is in center of the floor tile
	if((position.x == path.back()->getCoords().x+scale/2) &&
			(position.y == path.back()->getCoords().y+scale/2)){
		lastLoc = location;
		location = path.back();
		path.pop_back();
		if(path.empty()){
			dead = false;
			moving = false;
			return;
		}
	}
}

vector<Terrain*> Ghost::getSurrounding(){
	return getSurrounding(location, lastLoc);
}

// find possible paths from the four immediately surrounding terrains
vector<Terrain*> Ghost::getSurrounding(Terrain * current, Terrain * last){

	vector <Terrain *> choices;

	if(current == NULL){
		return choices;
	}

	//add all surrounding floor tiles (don't add walls)
	//only adds those moves not equal to the last location
	if(current->getNorth() != NULL && 
			current->getNorth()->getHeight() == current->getHeight()){
		if(current->getNorth() != last)
			choices.push_back(current->getNorth());
	}

	if(current->getSouth() != NULL && 
			current->getSouth()->getHeight() == current->getHeight()){
		if(current->getSouth() != last)
			choices.push_back(current->getSouth());
	}

	if(current->getEast() != NULL && 
			current->getEast()->getHeight() == current->getHeight()){
		if(current->getEast() != last)
			choices.push_back(current->getEast());
	}

	if(current->getWest() != NULL && 
			current->getWest()->getHeight() == current->getHeight()){
		if(current->getWest() != last)
			choices.push_back(current->getWest());
	}

	return choices;
}

double Ghost::heuristic(Terrain * t){
	double GhostX = t->getCoords().x;
	double GhostY = t->getCoords().y;
	double HomeX = home->getCoords().x;
	double HomeY = home->getCoords().y;
	double HeurX, HeurY;

	if(GhostX > HomeX)
		HeurX = GhostX - HomeX;
	else
		HeurX = HomeX - GhostX;

	if(GhostY > HomeY)
		HeurY = GhostY - HomeY;
	else
		HeurY = HomeY - GhostY;

	return HeurX + HeurY;
}

//test if ghost has reached home
bool Ghost::homeTest(Terrain * current){
	if(current == home)
		return true;
	return false;
}

//test if pacman and ghost collide
bool Ghost::pacmanTest(Terrain * current){

	//ghost is below pacman
	if((position.x - radius < pacLoc.x + pacRad) && 
		(position.x + radius > pacLoc.x - pacRad) &&
		(position.y + radius > pacLoc.y - pacRad) && 
		(position.y - radius < pacLoc.y + pacRad))
		return true;

	// ghost is above pacman
	if((position.x - radius < pacLoc.x + pacRad) && 
		(position.x + radius > pacLoc.x - pacRad) &&
		(position.y + radius > pacLoc.y - pacRad) && 
		(position.y - radius < pacLoc.y + pacRad))
		return true;

	if((position.x - radius < pacLoc.x + pacRad) && 
		(position.x + radius > pacLoc.x - pacRad) &&
		(position.y + radius > pacLoc.y - pacRad) && 
		(position.y - radius < pacLoc.y + pacRad))
		return true;

	if((position.x - radius < pacLoc.x + pacRad) && 
		(position.x + radius > pacLoc.x - pacRad) &&
		(position.y + radius > pacLoc.y - pacRad) && 
		(position.y - radius < pacLoc.y + pacRad))
		return true;

	return false;
}