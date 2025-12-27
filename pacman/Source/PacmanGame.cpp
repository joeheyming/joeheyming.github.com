#include "Game.h"
#include <iostream>
#include <string>
#include <GL/glut.h>

using namespace std;

// constant program declarations
const char * TITLE = "3D Pacman";

const float WORLD_WIDTH = 800,
	WORLD_HEIGHT = 800,
	WORLD_DEPTH = 800,
	WORLD_ORIGIN_X = 800,
	WORLD_ORIGIN_Y = 800,
	WORLD_ORIGIN_Z = 800;

int WINDOW_ORIGIN_X = 100,
	WINDOW_ORIGIN_Y = 100;

// global light definitions
/*GLfloat my_ambient_light[] = { 0.5, 0.5, 0.5, 1.0 };
GLfloat my_diffuse_light[] = { 1.0, 0.0, 0.0, 1.0 };
GLfloat my_specular_light[] = { 1.0, 0.0, 0.0, 1.0 };
GLfloat my_light_position[] = { 1.0, 1.0, -10.0, 1.0 };*/

Game * game;

int frameRate = 1000/24;

void openGLinit();
void displayFcnWrapper();
void mouseFcnWrapper(int button, int state, int x, int y);
void reshapeFcnWrapper(int newWidth, int newHeight);
void keyboardFcnWrapper(unsigned char key, int x, int y);
void motionFcnWrapper(int x, int y);
void idleFcnWrapper();
void updateFcnWrapper(int x);
void specialFcnWrapper(int keys, int x, int y);
void passiveFcnWrapper(int x, int y);

int main(int argc, char** argv){

	cout << "Pacman" << endl;

	game = new Game();

	glutInit(&argc, argv);
	glutInitDisplayMode(GLUT_RGBA | GLUT_DOUBLE | GLUT_DEPTH);

	glutInitWindowPosition(WINDOW_ORIGIN_X, WINDOW_ORIGIN_Y);
	glutInitWindowSize((int)game->getWidth(), (int)game->getHeight());
	glutCreateWindow(TITLE);

	openGLinit(); // set attributes

	glutDisplayFunc(displayFcnWrapper);
	glutMouseFunc(mouseFcnWrapper);
	glutReshapeFunc(reshapeFcnWrapper);
	glutKeyboardFunc(keyboardFcnWrapper);
	glutMotionFunc(motionFcnWrapper);
	glutIdleFunc(idleFcnWrapper);
	glutSpecialFunc(specialFcnWrapper);
	glutPassiveMotionFunc(passiveFcnWrapper);

	glutTimerFunc(frameRate,updateFcnWrapper,0);

	glutMainLoop(); // enter event loop

	return 0;
}

void openGLinit(){

	glEnable(GL_DEPTH_TEST);
	glEnable(GL_NORMALIZE);
	glEnable(GL_LIGHTING);
	glEnable(GL_COLOR_MATERIAL);
	//glEnable(GL_CULL_FACE);
	glEnable(GL_BLEND);
	glEnable(GL_POLYGON_OFFSET_FILL);

	glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	glColorMaterial(GL_FRONT, GL_AMBIENT_AND_DIFFUSE);

	glShadeModel(GL_SMOOTH);

	glClearColor(0.0, 0.0, 0.0, 1.0); // black background

	glMatrixMode(GL_PROJECTION);
	glOrtho(WORLD_ORIGIN_X, WORLD_WIDTH,
		WORLD_ORIGIN_Y, WORLD_HEIGHT,
		WORLD_ORIGIN_Z, WORLD_DEPTH);

	glMatrixMode(GL_MODELVIEW);
}

void displayFcnWrapper()
{
   game->displayFcn();
}

void mouseFcnWrapper(int button, int state, int x, int y)
{
   game->mouseFcn(button, state, x, y);
}

void reshapeFcnWrapper(int newWidth, int newHeight)
{
   game->reshapeFcn(newWidth, newHeight);
}

void keyboardFcnWrapper(unsigned char key, int x, int y)
{
   game->keyboardFcn(key, x, y);
}

void motionFcnWrapper(int x, int y)
{
   game->motionFcn(x, y);
}

void idleFcnWrapper()
{
   game->idleFcn();
}

void updateFcnWrapper(int x)
{
   game->updateFcn(x);
   glutTimerFunc(frameRate, updateFcnWrapper, 0);
}

void specialFcnWrapper(int keys, int x, int y)
{
   game->specialFcn(keys, x, y);
}

void passiveFcnWrapper(int x, int y){

	game->passiveMouseFcn(x,y);
}
