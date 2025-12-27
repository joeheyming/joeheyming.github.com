#include "Pacman.h"

Pacman::Pacman(double startx, double starty, 
	       double startz, double _scale,
	       Terrain * p, int * _gameStatus,
		   vector<Vector> * _teleports){
	alpha = 1.0;
	location = p;

	scale = _scale;

	gameStatus = _gameStatus;

	teleports = _teleports;

	radius = (2*scale)/5;
  
	double pos[3] = {startx*scale+scale/2, 
		starty*scale+scale/2, 
		startz*scale+scale/2};
	position = pos;

	double a[3] = {0,1,0};
	double b[3] = {0,-1,0};
	double c[3] = {-1,0,0};
	double d[3] = {1,0,0};

	up = a;
	down = b;
	left = c;
	right = d;

	facing = down;
	strafe = d;

	clip_bottom[0] = 0.0;
	clip_bottom[1] = 0.0;
	clip_bottom[2] = 1.0;
	clip_bottom[3] = 0.5;

	clip_top[0] = 0.0;
	clip_top[1] = 0.0;
	clip_top[2] = -1.0;
	clip_top[3] = 0.5;

	//currentLevel = level;
	moveSpeed = 2;
	rotateSpeed = 15;
	mouthAngle = 45.0;
	toggle = 1;

	roll = pitch = 0.0;
	yaw = 180;

	status = FLEE;

	score = 0;

	counter = 0;

	chomp = false;
}

void Pacman::update(){
	if(counter == 0)
		status = FLEE;
	if(counter > 0)
		counter--;
}

void setScreenPt(double thX, double thY,
		 double nearZ, double farZ,
		 double width, double height){
}

void Pacman::animate(){
	if(chomp){
		if(toggle == 1)
			mouthAngle += 5;
		else
			mouthAngle -= 5;
		if(mouthAngle > 45 || mouthAngle < 0){
			toggle = !toggle;
			if(toggle == 1)
				chomp = false;
		}
	}
}

void Pacman::deathAnimation(){
	if(radius > 0){
		radius -= .2;
	}
	else{
		Sleep(1000);
		exit(0);
	}
}

void Pacman::draw(){
	glPushMatrix();
	qd = gluNewQuadric();

	// bring the model to the coordinates
	glTranslatef(position.x, position.y, position.z);
	// rotate the model to face the correct direction
	glRotatef(yaw, 0.0, 0.0, 1.0);

	// draw the eyes
	drawEyes();

	// draw the body with animation of body
	// due to the mouth angle
	glPushMatrix();
		glRotatef(mouthAngle, 1.0, 0.0, 0.0);
		drawTop();
	glPopMatrix();
	glPushMatrix();
		glRotatef(-mouthAngle, 1.0, 0.0, 0.0);
		drawBottom();
	glPopMatrix();

	gluDeleteQuadric(qd);

	glPopMatrix();
}

void Pacman::drawEyes(){
	// make them black
	glColor4f(0.0, 0.0, 0.0, alpha);
	glPushMatrix();
	  // translate the eye to the radius of the body
	  // rotate the eye up above the max mouth angle
	  // rotate each eye by a symetrical amount
	  glRotatef(30, 0.0, 0.0, 1.0);
	  glRotatef(50, 1.0, 0.0, 0.0);
	  glTranslatef(0,radius,0);
	  glutSolidSphere(radius/5, 6, 6); 
	glPopMatrix();
	glPushMatrix();
	  glRotatef(-30, 0.0, 0.0, 1.0);
	  glRotatef(50, 1.0, 0.0, 0.0);
	  glTranslatef(0,radius,0);
	  glutSolidSphere(radius/5, 6, 6);
	glPopMatrix();
}

void Pacman::drawTop(){
	// make his mouth black and draw it
	glColor4f(0.0, 0.0, 0.0, alpha);
	gluDisk(qd,0.0f,radius-0.2,32,32);	

	// draw a yellow half sphere
	glColor4f(1.0, 1.0, 0.0, alpha);
	glClipPlane(GL_CLIP_PLANE1,clip_bottom);
	glEnable(GL_CLIP_PLANE1);
	gluSphere(qd,radius,32,32);
	glDisable(GL_CLIP_PLANE1);
}

void Pacman::drawBottom(){
	// make his mouth black and draw it
	glColor4f(0.0, 0.0, 0.0, alpha);
	gluDisk(qd,0.0f,radius-0.2,32,32);	

	// draw a yellow half sphere
	glColor4f(1.0, 1.0, 0.0, alpha);
	glClipPlane(GL_CLIP_PLANE1,clip_top);
	glEnable(GL_CLIP_PLANE1);
	gluSphere(qd,radius,32,32);
	glDisable(GL_CLIP_PLANE1);
}

void Pacman::move(char direction, int mode){

	double oldYaw = yaw;
	Vector oldPos = position;
	//Terrain oldLoc = *location;
	Vector collisionVector = facing;

	switch(mode){

	case KEY_ROTATE:
		switch(direction){
			case 'l': yaw += rotateSpeed;
			break;
		case 'r': 
			yaw -= rotateSpeed;
			break;
		case 'u': 	
			position = position + (facing * moveSpeed);
			break;
		case 'd':
			position = position - (facing * moveSpeed);
			break;
		}
		break;
	case KEY_STRAFE:
		switch(direction){
		case 'l':
			position = position - (strafe * moveSpeed);
			collisionVector = -strafe;
			break;
		case 'r':
			position = position + (strafe * moveSpeed);
			collisionVector = strafe;
			break;
		case 'u':
			position = position + (facing * moveSpeed);
			break;
		case 'd':
			position = position - (facing * moveSpeed);
			break;
		}
		break;
	case KEY_PERP:
		switch(direction){
		case 'l': 
			facing = left;
			position.x -= moveSpeed;
			yaw = 90;
			break;
		case 'r': 
			facing = right;
			position.x += moveSpeed;
			yaw = 270;
			break;
		case 'u': 	
			facing = up;
			position.y += moveSpeed;
			yaw = 0;
			break;
		case 'd': 
			facing = down;
			position.y -= moveSpeed;
			yaw = 180;
			break;
		}
		break;
	}

	facing.x = - sin((yaw*PI)/180.0);
	facing.y = cos((yaw*PI)/180.0);
	facing.z = facing.z;

	strafe.x = cos((yaw*PI)/180.0);
	strafe.y = sin((yaw*PI)/180.0);
	strafe.z = facing.z;

	testDot();

	switch(collision()){
	case N: case S:
		position.y = oldPos.y;
		break;
	case E: case W:
		position.x = oldPos.x;
		break;
	case NE:
		// if you are hitting a wall, not a corner, only update
		// relative coordinate (used when able to rotate & hit
		// wall at an angle)
		if(location->getNorth()->getHeight()*scale > position.z-radius){
			position.y = oldPos.y;			
		}
		if(location->getEast()->getHeight()*scale > position.z-radius){
			position.x = oldPos.x;
		}
		//otherwise you're hitting a corner, so update both coords
		if(location->getNorth()->getHeight()*scale <= position.z-radius &&
			location->getEast()->getHeight()*scale <= position.z-radius){
			position.y = oldPos.y;
			position.x = oldPos.x;
		}
		break;
	case SE:
		// if you are hitting a wall, not a corner, only update
		// relative coordinate (used when able to rotate & hit
		// wall at an angle)
		if(location->getSouth()->getHeight()*scale > position.z-radius)
			position.y = oldPos.y;
		if(location->getEast()->getHeight()*scale > position.z-radius)
			position.x = oldPos.x;
		//otherwise you're hitting a corner, so update both coords
		if(location->getSouth()->getHeight()*scale <= position.z-radius &&
			location->getEast()->getHeight()*scale <= position.z-radius){
			position.y = oldPos.y;
			position.x = oldPos.x;
		}
		break;
	case SW:
		// if you are hitting a wall, not a corner, only update
		// relative coordinate (used when able to rotate & hit
		// wall at an angle)
		if(location->getSouth()->getHeight()*scale > position.z-radius)
			position.y = oldPos.y;
		if(location->getWest()->getHeight()*scale > position.z-radius)
			position.x = oldPos.x;
		//otherwise you're hitting a corner, so update both coords
		if(location->getSouth()->getHeight()*scale <= position.z-radius &&
			location->getWest()->getHeight()*scale <= position.z-radius){
			position.y = oldPos.y;
			position.x = oldPos.x;
		}
		break;
	case NW:
		// if you are hitting a wall, not a corner, only update
		// relative coordinate (used when able to rotate & hit
		// wall at an angle)
		if(location->getNorth()->getHeight()*scale > position.z-radius){
			position.y = oldPos.y;
		}
		if(location->getWest()->getHeight()*scale > position.z-radius){
			position.x = oldPos.x;		
		}
		//otherwise you're hitting a corner, so update both coords
		if(location->getNorth()->getHeight()*scale <= position.z-radius &&
				location->getWest()->getHeight()*scale <= position.z-radius){
			position.y = oldPos.y;
			position.x = oldPos.x;			
		}
		break;
	default:
		break;
	}
  
	if(location == NULL)
		return;

	// if we have moved into the east terrain
	if(position.x > location->getCoords().x + scale)
		location = location->getEast();

	if(location == NULL)
		return;

	// if we have moved into the west terrain
	if(position.x < location->getCoords().x)
		location = location->getWest();

	if(location == NULL)
		return;

	// if we have moved into the north terrain
	if(position.y > location->getCoords().y + scale)
		location = location->getNorth();

	if(location == NULL)
		return;

	// if we have moved into the south terrain
	if(position.y < location->getCoords().y)
		location = location->getSouth();

	if(location == NULL)
		return;

	//teleport, update position
	if(!location->intersect(position)){
		Vector newPos = location->getCoords();
		newPos.x = newPos.x + scale/2;
		newPos.y = newPos.y + scale/2;

		cout << position << endl;
		cout << newPos << endl;
		cout << location->getCoords() << endl;

		position.x = newPos.x;
		position.y = newPos.y;
	}

	if(yaw > 360 || yaw < -360)
		yaw = 0;
}

void Pacman::testDot(){
	int dot;
	int pillScore = 10;
	int powerPillScore = 50;

	int oldScore = score;

	dot = location->updateDot(position, radius);
	if(dot > 0){
		score += pillScore;
		PlaySound("CHOMP.wav",NULL,SND_FILENAME|SND_ASYNC);
		chomp = true;
		if(dot > 1){
			status = CHASE;
			score += powerPillScore - pillScore;
			counter = 100;
			PlaySound("LARGEPELLET.wav",NULL,SND_FILENAME|SND_ASYNC);
		}
	}
	

	dot = location->getNorth()->updateDot(position, radius);
	if(dot > 0){
		score += pillScore;
		PlaySound("CHOMP.wav",NULL,SND_FILENAME|SND_ASYNC);
		chomp = true;
		if(dot > 1){
			status = CHASE;
			score += powerPillScore - pillScore;
			counter = 100;
			PlaySound("LARGEPELLET.wav",NULL,SND_FILENAME|SND_ASYNC);
		}
	}

	dot = location->getEast()->updateDot(position, radius);
	if(dot > 0){
		score += pillScore;
		PlaySound("CHOMP.wav",NULL,SND_FILENAME|SND_ASYNC);
		chomp = true;
		if(dot > 1){
			status = CHASE;
			score += powerPillScore - pillScore;
			counter = 100;
			PlaySound("LARGEPELLET.wav",NULL,SND_FILENAME|SND_ASYNC);
		}
	}

	dot = location->getSouth()->updateDot(position, radius);
	if(dot > 0){
		score += pillScore;
		PlaySound("CHOMP.wav",NULL,SND_FILENAME|SND_ASYNC);
		chomp = true;
		if(dot > 1){
			status = CHASE;
			score += powerPillScore - pillScore;
			counter = 100;
			PlaySound("LARGEPELLET.wav",NULL,SND_FILENAME|SND_ASYNC);
		}
	}

	dot = location->getWest()->updateDot(position, radius);
	if(dot > 0){
		score += pillScore;
		PlaySound("CHOMP.wav",NULL,SND_FILENAME|SND_ASYNC);
		chomp = true;
		if(dot > 1){
			status = CHASE;
			score += powerPillScore - pillScore;
			counter = 100;
			PlaySound("LARGEPELLET.wav",NULL,SND_FILENAME|SND_ASYNC);
		}
	}
}

//check if new position collides with wall
int Pacman::collision(){
	Vector edgePosition = position;

	edgePosition.z -= scale/2;

	int returnValue = 0;

	if(location == NULL)
		return 0;

	//location has not been updated - you are testing
	//for a collision while in transition between terrains
	if(!location->intersect(position)){
		//reset the offending value
		if(position.x < location->getCoords().x)
			edgePosition.x = location->getCoords().x + 1;
		if(position.x > location->getCoords().x + scale)
			edgePosition.x = location->getCoords().x + scale - 1;
		if(position.y < location->getCoords().y)
			edgePosition.y = location->getCoords().y + 1;
		if(position.y > location->getCoords().y + scale)
			edgePosition.y = location->getCoords().y + scale - 1;
	}


	//north
	edgePosition.y += radius;
	if(location->getNorth()->intersect(edgePosition) && 
			location->getNorth()->getHeight()*scale > edgePosition.z){
		returnValue = N;
	}

	//northeast
	edgePosition.x += radius;
	if(location->getNorth()->getEast()->intersect(edgePosition) && 
			location->getNorth()->getEast()->getHeight()*scale > edgePosition.z){
		return NE;
	}

	//east
	edgePosition.y -= radius;
	if(location->getEast()->intersect(edgePosition) && 
			location->getEast()->getHeight()*scale > edgePosition.z){
		if(returnValue == N)
			return NE;
		else
			returnValue = E;
	}

	//southeast
	edgePosition.y -= radius;
	if(location->getSouth()->getEast()->intersect(edgePosition) && 
			location->getSouth()->getEast()->getHeight()*scale > edgePosition.z){
		return SE;
	}

	//south
	edgePosition.x -= radius;
	if(location->getSouth()->intersect(edgePosition) && 
			location->getSouth()->getHeight()*scale > edgePosition.z){
		if(returnValue == E)
			return SE;
		else
			returnValue = S;
	}

	//southwest
	edgePosition.x -= radius;
	if(location->getSouth()->getWest()->intersect(edgePosition) && 
			location->getSouth()->getWest()->getHeight()*scale > edgePosition.z){
		return SW;
	}

	//west
	edgePosition.y += radius;
	if(location->getWest()->intersect(edgePosition) && 
			location->getWest()->getHeight()*scale > edgePosition.z){
		if(returnValue == S)
			return SW;
		if(returnValue == N)
			return NW;
		else
			returnValue = W;
	}

	//northwest
	edgePosition.y += radius;
	if(location->getNorth()->getWest()->intersect(edgePosition) && 
			location->getNorth()->getWest()->getHeight()*scale > edgePosition.z){
		return NW;
	}

	return returnValue;
}
