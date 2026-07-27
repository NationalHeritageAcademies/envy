<?php

declare(strict_types=1);

namespace Site\Controllers;

use Melodic\Controller\MvcController;
use Melodic\Core\Application;
use Melodic\Http\Response;

class TermsController extends MvcController
{
    public function __construct(\Melodic\View\ViewEngine $viewEngine, private readonly Application $app)
    {
        parent::__construct($viewEngine);
    }

    public function index(): Response
    {
        $this->setLayout('layouts/main');

        $this->viewBag->title = 'Terms & License — Envy';
        $this->viewBag->description = 'Envy is free, MIT-licensed open source. What that means, '
            . 'plus the usual warranty disclaimers.';
        $this->viewBag->canonical = 'https://' . $this->app->config('app.domain', 'envy.melodic.dev') . '/terms';

        return $this->view('terms/index', [
            'config' => $this->app->getConfiguration()->all(),
        ]);
    }
}
